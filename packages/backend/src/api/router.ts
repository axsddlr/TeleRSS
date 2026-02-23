import { Router, IRouter } from 'express';
import { feedsRouter } from './feeds';
import { subscriptionsRouter } from './subscriptions';
import { statsRouter } from './stats';
import { botRouter } from './bot';

export const apiRouter: IRouter = Router();

apiRouter.use('/feeds', feedsRouter);
apiRouter.use('/subscriptions', subscriptionsRouter);
apiRouter.use('/stats', statsRouter);
apiRouter.use('/bot', botRouter);
