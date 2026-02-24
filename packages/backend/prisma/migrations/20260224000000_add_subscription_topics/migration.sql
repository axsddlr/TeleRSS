ALTER TABLE "Subscription" ADD COLUMN "topicName" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "topicNameKey" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "topicThreadId" INTEGER;

CREATE INDEX "Subscription_chatId_topicNameKey_topicThreadId_idx"
ON "Subscription"("chatId", "topicNameKey", "topicThreadId");
