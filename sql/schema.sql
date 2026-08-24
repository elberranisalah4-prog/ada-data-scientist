CREATE DATABASE IF NOT EXISTS ada CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE ada;

CREATE TABLE IF NOT EXISTS runs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  target VARCHAR(128) NULL,
  status ENUM('running', 'done', 'error') NOT NULL DEFAULT 'running',
  task VARCHAR(32) NULL,
  selected_model VARCHAR(128) NULL,
  scoring VARCHAR(64) NULL,
  rows_in INT NULL,
  rows_clean INT NULL,
  error_message TEXT NULL,
  result_json LONGTEXT NULL,
  report_md MEDIUMTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  KEY idx_runs_created (created_at),
  KEY idx_runs_status (status)
);

CREATE TABLE IF NOT EXISTS findings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  stage VARCHAR(32) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  title VARCHAR(512) NOT NULL,
  detail TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_findings_run (run_id),
  CONSTRAINT fk_findings_run FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stage_logs (
  run_id CHAR(36) NOT NULL,
  stage VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  intent TEXT NULL,
  summary VARCHAR(512) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, stage),
  CONSTRAINT fk_stages_run FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE
);
