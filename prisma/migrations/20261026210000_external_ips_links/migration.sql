CREATE TABLE "external_ips_links" (
    "id" TEXT NOT NULL,
    "external_subject" TEXT NOT NULL,
    "ips_id" TEXT NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "access_token_encrypted" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "status" "IpsLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "external_ips_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_ips_links_external_subject_key" ON "external_ips_links"("external_subject");

ALTER TABLE "external_ips_links" ADD CONSTRAINT "external_ips_links_ips_id_fkey" FOREIGN KEY ("ips_id") REFERENCES "ips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
