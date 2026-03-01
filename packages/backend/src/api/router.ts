import { Router, IRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { feedsRouter } from './feeds';
import { subscriptionsRouter } from './subscriptions';
import { statsRouter } from './stats';
import { botRouter } from './bot';
import { authRouter, authProtectedRouter } from './auth';
import { requireAuth } from '../middleware/requireAuth';

export const apiRouter: IRouter = Router();

// Rate limiter for all API endpoints (applied after auth)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 60, // 60 requests per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

apiRouter.use('/auth', authRouter);        // public: login
apiRouter.use(requireAuth);               // all routes below require valid JWT
apiRouter.use(apiLimiter);                // rate limit all authenticated endpoints
apiRouter.use('/auth', authProtectedRouter); // protected: status, change-password

apiRouter.use('/feeds', feedsRouter);
apiRouter.use('/subscriptions', subscriptionsRouter);
apiRouter.use('/stats', statsRouter);
apiRouter.use('/bot', botRouter);
