-- Migration 0004: Add multi-page support
-- Run this SQL directly on your database if Django migrations can't run

-- 1. Make image_url optional (modify column to allow NULL/blank)
-- For PostgreSQL:
ALTER TABLE attendance_attendanceupload ALTER COLUMN image_url DROP NOT NULL;

-- 2. Create AttendanceUploadImage table for multi-page support
CREATE TABLE IF NOT EXISTS attendance_attendanceuploadimage (
    id BIGSERIAL PRIMARY KEY,
    upload_id BIGINT NOT NULL REFERENCES attendance_attendanceupload(id) ON DELETE CASCADE,
    image_url VARCHAR(500) NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    ocr_raw_text TEXT DEFAULT '',
    structured_table_json JSONB NULL,
    processing_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    error_message TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (upload_id, page_number)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS attendance_attendanceuploadimage_upload_id_idx
    ON attendance_attendanceuploadimage(upload_id);

-- 3. Record the migration in Django's migration table
INSERT INTO django_migrations (app, name, applied)
VALUES ('attendance', '0004_add_multi_page_support', NOW())
ON CONFLICT DO NOTHING;
