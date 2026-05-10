-- Script khởi tạo Postgres — chỉ chạy MỘT LẦN khi DB rỗng (lúc volume mới tạo).
-- Postgres tự động chạy mọi file .sql/.sh trong /docker-entrypoint-initdb.d/.

-- pgvector: lưu trữ + ANN search vector embedding (chunks, concepts).
CREATE EXTENSION IF NOT EXISTS vector;

-- pg_trgm: trigram similarity — dùng cho "Did you mean?" search và filter
-- gần đúng tên concept khi extraction.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- uuid-ossp: tạo UUID phía DB nếu cần (ví dụ default value cho cột UUID).
-- App hiện tại dùng cuid2 phía Node nhưng để extension này sẵn cho linh hoạt.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
