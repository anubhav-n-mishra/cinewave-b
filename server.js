import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { createClient } from '@supabase/supabase-js';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'https://cinewave-frontend-gules.vercel.app';
const app = express();

// Allow your React app origin
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});

// In-memory map of rooms → host socket
const rooms = {};

// Initialize Supabase client
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

io.on('connection', (socket) => {
  console.log('⏩ client connected:', socket.id);

  socket.on('join-room', ({ roomId, username, isHost }) => {
    socket.join(roomId);
    console.log(`Client ${socket.id} (${username}, isHost: ${isHost}) joined room ${roomId}`);

    if (isHost) {
      rooms[roomId] = { hostId: socket.id };
    }

    // Let everyone know how many are in the room
    const count = io.sockets.adapter.rooms.get(roomId)?.size || 0;
    console.log(`Participants in room ${roomId}: ${count}`);
    io.to(roomId).emit('participants', count);

    // Acknowledge join
    socket.emit('room-joined', { roomId, isHost });

    // 1) Tell the new client who's already in the room
    const existing = Array.from(io.sockets.adapter.rooms.get(roomId) || []).filter(
      (id) => id !== socket.id
    );
    socket.emit('all-users', { users: existing });

    // 2) Tell the existing clients that somebody new just joined
    socket.to(roomId).emit('user-joined', { userId: socket.id });
  });

  socket.on('play', ({ roomId, currentTime }) => {
    console.log(`Play event in room ${roomId} at ${currentTime}`);
    socket.to(roomId).emit('play', { currentTime });
  });

  socket.on('pause', ({ roomId, currentTime }) => {
    console.log(`Pause event in room ${roomId} at ${currentTime}`);
    socket.to(roomId).emit('pause', { currentTime });
  });

  socket.on('seek', ({ roomId, currentTime }) => {
    console.log(`Seek event in room ${roomId} at ${currentTime}`);
    socket.to(roomId).emit('seek', { currentTime });
  });

  socket.on('chat-message', ({ roomId, message, author }) => {
    const timestamp = new Date().toISOString();
    console.log(`Chat message in room ${roomId} from ${author}: ${message}`);
    io.to(roomId).emit('chat-message', { author, message, timestamp });
  });

  // WebRTC signalling relay
  socket.on('signal', ({ to, signal }) => {
    console.log(`Signal from ${socket.id} to ${to}`);
    io.to(to).emit('signal', { from: socket.id, signal });
  });

  socket.on('disconnect', () => {
    console.log('⏪ client disconnected:', socket.id);
    // Clean up rooms
    for (const roomId in rooms) {
      if (rooms[roomId].hostId === socket.id) {
        delete rooms[roomId];
      }
      const count = io.sockets.adapter.rooms.get(roomId)?.size || 0;
      io.to(roomId).emit('participants', count);
    }
  });
});

// Create order endpoint
app.post('/api/create-order', async (req, res) => {
  try {
    const { amount, currency } = req.body;

    const options = {
      amount: amount,
      currency: currency,
      receipt: `order_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Verify payment endpoint
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, planData } = req.body;

    console.log('Received payment verification request:', {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature: razorpay_signature ? 'present' : 'missing',
      planData: planData ? 'present' : 'missing',
    });

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_SECRET)
      .update(body.toString())
      .digest('hex');

    console.log('Signature verification:', {
      expected: expectedSignature,
      received: razorpay_signature,
      match: expectedSignature === razorpay_signature,
    });

    if (expectedSignature === razorpay_signature) {
      // Create subscription in Supabase
      const { data, error } = await supabase
        .from('subscriptions')
        .insert([
          {
            user_id: planData.user_id,
            plan_id: planData.id,
            plan_name: planData.name,
            amount: planData.amount,
            currency: planData.currency,
            payment_id: razorpay_payment_id,
            status: 'active',
            start_date: new Date().toISOString(),
            end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
          },
        ])
        .select()
        .single();

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      console.log('Payment verified and subscription created successfully');
      res.json({ success: true, subscription: data });
    } else {
      console.error('Signature mismatch');
      res.status(400).json({
        error: 'Invalid signature',
        details: {
          expected: expectedSignature,
          received: razorpay_signature,
        },
      });
    }
  } catch (error) {
    console.error('Error in verify-payment:', error);
    res.status(500).json({
      error: 'Failed to verify payment',
      details: error.message,
    });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});