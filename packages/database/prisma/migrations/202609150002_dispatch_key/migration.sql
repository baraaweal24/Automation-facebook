ALTER TABLE "Post" ADD COLUMN "dispatchKey" TEXT;
CREATE UNIQUE INDEX "Post_dispatchKey_key" ON "Post"("dispatchKey");
