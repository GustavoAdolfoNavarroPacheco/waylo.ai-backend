CREATE TABLE "agent_executions" (
    "id" TEXT NOT NULL,
    "external_subject_hash" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "tool_names" JSONB NOT NULL,
    "tool_count" INTEGER NOT NULL,
    "retry_count" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_executions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_executions_created_at_idx" ON "agent_executions"("created_at");
CREATE INDEX "agent_executions_status_created_at_idx" ON "agent_executions"("status", "created_at");
