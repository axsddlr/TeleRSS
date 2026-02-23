CREATE TABLE "KnownChat" (
    "chatId"    TEXT     NOT NULL PRIMARY KEY,
    "chatName"  TEXT     NOT NULL,
    "chatType"  TEXT     NOT NULL,
    "isAdmin"   BOOLEAN  NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);
