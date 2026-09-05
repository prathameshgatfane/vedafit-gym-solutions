-- Runs automatically on first container start (docker-entrypoint-initdb.d convention).
-- gym_test is not created by MYSQL_DATABASE (docker-compose.yml only creates gym_dev), and
-- gym_app needs CREATE/DROP DATABASE globally so `prisma migrate dev` can create its shadow
-- database. This is an isolated local dev/test MySQL container, so granting broadly is fine.
CREATE DATABASE IF NOT EXISTS gym_test CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
GRANT ALL PRIVILEGES ON *.* TO 'gym_app'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
