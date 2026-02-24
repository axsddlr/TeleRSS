import { Router, IRouter } from 'express';
import { feedsRouter } from './feeds';
import { subscriptionsRouter } from './subscriptions';
import { statsRouter } from './stats';
import { botRouter } from './bot';
import { authRouter, authProtectedRouter } from './auth';
import { requireAuth } from '../middleware/requireAuth';

export const apiRouter: IRouter = Router();

apiRouter.use('/auth', authRouter);        // public: login
apiRouter.use(requireAuth);               // all routes below require valid JWT
apiRouter.use('/auth', authProtectedRouter); // protected: status, change-password

apiRouter.use('/feeds', feedsRouter);
apiRouter.use('/subscriptions', subscriptionsRouter);
apiRouter.use('/stats', statsRouter);
apiRouter.use('/bot', botRouter);
