require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env'
});
const express = require('express');
const sgMail = require('@sendgrid/mail');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./auth');  // Import your auth.js
const finalSheetRoutes = require('./finalSheet');  // Import your finalSheet.js
const googleSheetsRoutes = require('./googleSheetsServer');  // Import your googleSheetsServer.js
const passport = require('passport');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

// Initialize Firebase Admin
const db = getFirestore();

const app = express();

// Middleware setup
app.use(cors({ origin: true, credentials: true }));    // commented to check in production
app.use(cors({ origin: ['https://contractorsandhandymanwebsites.com', 'https://www.contractorsandhandymanwebsites.com'] }));
app.use(express.json()); 
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false, // Set to true in production with HTTPS
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        httpOnly: true,  // Prevent access via JavaScript
        sameSite: 'lax' // Default to lax
    }
}));
app.use(passport.initialize());
app.use(passport.session());

// Initialize SendGrid with the API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const adminEmail = process.env.ADMIN_EMAIL;

// In-memory storage
const otpStore = {}; // Stores OTPs temporarily
const submittedForms = {}; // Tracks verified forms

// Generate a 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Rate limiter to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP
  message: 'Too many requests, please try again later.',
});

// ✅ Handle Form Submission & OTP Generation
app.post('/submit-form', limiter, async (req, res) => {
  try {
    const { name, email, phone, description } = req.body;
    if (!name || !email || !phone || !description) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    // Check if the user has already verified a form
    if (submittedForms[email]) {
      return res.status(400).json({ message: 'You have already submitted the form.' });
    }
    // Generate OTP
    const otp = generateOTP();
    otpStore[email] = { otp, expiresAt: Date.now() + 300000, name, phone, description }; // Store OTP & form details
    // Send OTP to user
    await sgMail.send({
      to: email,
      from: process.env.SENDER_EMAIL,
      subject: 'Your OTP Code',
      html: `<p>Your OTP is <strong>${otp}</strong>. It is valid for 5 minutes.</p>`,
    });
    res.status(200).json({ message: 'OTP sent to your email. Please verify to complete submission.' });
  } catch (error) {
    console.error('Error during form submission:', error);
    res.status(500).json({ message: 'Failed to submit form. Please try again later.' });
  }
});

// ✅ Verify OTP & Confirm Submission
app.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ message: 'Email and OTP are required' });
  }
  try {
    if (otpStore[email] && otpStore[email].otp === otp && otpStore[email].expiresAt > Date.now()) {
      const { name, phone, description } = otpStore[email]; // Retrieve form details
      delete otpStore[email]; // Remove OTP after verification
      submittedForms[email] = true; // Mark user as submitted
      // Send confirmation email to user
      await sgMail.send({
        to: email,
        from: process.env.SENDER_EMAIL,
        subject: 'Form Submission Confirmed',
        html: '<p>Your form submission has been confirmed successfully.</p>',
      });
      // ✅ Notify admin that OTP is verified and form is submitted
      await sgMail.send({
        to: adminEmail,
        from: process.env.SENDER_EMAIL,
        subject: 'New Form Submission (Verified)',
        html: `<p><strong>Name:</strong> ${name}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p><strong>Phone:</strong> ${phone}</p>
               <p><strong>Description:</strong> ${description}</p>
               <p><strong>Status:</strong> Submission Verified ✅</p>`,
      });
      res.status(200).json({ message: 'OTP verified successfully. Form submitted, and admin has been notified.' });
    } else {
      res.status(400).json({ message: 'Invalid or expired OTP' });
    }
  } catch (error) {
    console.error('Error during OTP verification:', error);
    res.status(500).json({ message: 'Failed to verify OTP. Please try again later.' });
  }
});

// Use the imported routes
app.use('/api/auth', authRoutes); // Set up the auth routes
app.use('/final-sheet', finalSheetRoutes); // Set up the finalSheet routes
app.use('/google-sheets', googleSheetsRoutes); // Set up the googleSheetsServer routes

// Example route to check if server is working
app.get('/', (req, res) => {
    res.send('Server is working!');
});

// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});