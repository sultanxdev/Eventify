import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { logger } from '../lib/logger';

const router = Router();
const prisma = new PrismaClient();

// POST /auth/signup
router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  const log = logger.child({ correlationId, action: 'signup' });

  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Email, password, and name are required',
        correlationId,
      });
      return;
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(409).json({
        error: 'CONFLICT',
        message: 'User with this email already exists',
        correlationId,
      });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
    });

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    log.info({ userId: user.id, email: user.email }, 'User registered successfully');

    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      token,
    });
  } catch (error) {
    log.error({ error }, 'Signup failed');
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId,
    });
  }
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  const log = logger.child({ correlationId, action: 'login' });

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Email and password are required',
        correlationId,
      });
      return;
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid credentials',
        correlationId,
      });
      return;
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid credentials',
        correlationId,
      });
      return;
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    log.info({ userId: user.id, email: user.email }, 'User logged in successfully');

    res.status(200).json({
      id: user.id,
      email: user.email,
      name: user.name,
      token,
    });
  } catch (error) {
    log.error({ error }, 'Login failed');
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId,
    });
  }
});

export { router as authRoutes };
