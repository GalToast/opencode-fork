CREATE TABLE `retrieval_document` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text,
	`source_type` text NOT NULL,
	`source_id` text,
	`title` text,
	`language` text,
	`fingerprint` text NOT NULL,
	`metadata` text,
	`outcome_score` real,
	`negative_signal` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `retrieval_document_project_idx` ON `retrieval_document` (`project_id`);
--> statement-breakpoint
CREATE INDEX `retrieval_document_session_idx` ON `retrieval_document` (`session_id`);
--> statement-breakpoint
CREATE INDEX `retrieval_document_source_idx` ON `retrieval_document` (`source_type`,`source_id`);
--> statement-breakpoint
CREATE INDEX `retrieval_document_fingerprint_idx` ON `retrieval_document` (`fingerprint`);
--> statement-breakpoint
CREATE TABLE `retrieval_chunk` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	`chunk_type` text,
	`content` text NOT NULL,
	`content_hash` text,
	`token_estimate` integer,
	`start_offset` integer,
	`end_offset` integer,
	`provenance` text,
	`outcome_score` real,
	`negative_signal` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `retrieval_document`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `retrieval_chunk_document_idx` ON `retrieval_chunk` (`document_id`);
--> statement-breakpoint
CREATE INDEX `retrieval_chunk_project_idx` ON `retrieval_chunk` (`project_id`);
--> statement-breakpoint
CREATE INDEX `retrieval_chunk_content_hash_idx` ON `retrieval_chunk` (`content_hash`);
--> statement-breakpoint
CREATE TABLE `retrieval_embedding` (
	`id` text PRIMARY KEY NOT NULL,
	`chunk_id` text NOT NULL,
	`project_id` text NOT NULL,
	`vector` blob NOT NULL,
	`provider_id` text,
	`model_id` text NOT NULL,
	`dimensions` integer NOT NULL,
	`embedding_hash` text,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`chunk_id`) REFERENCES `retrieval_chunk`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `retrieval_embedding_chunk_idx` ON `retrieval_embedding` (`chunk_id`);
--> statement-breakpoint
CREATE INDEX `retrieval_embedding_project_idx` ON `retrieval_embedding` (`project_id`);
--> statement-breakpoint
CREATE INDEX `retrieval_embedding_model_idx` ON `retrieval_embedding` (`model_id`);
--> statement-breakpoint
CREATE TABLE `retrieval_run` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text,
	`query` text NOT NULL,
	`policy_name` text NOT NULL,
	`result_limit` integer,
	`latency_ms` integer,
	`candidate_count` integer,
	`selected_count` integer,
	`embedding_model_id` text,
	`reranker_model_id` text,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `retrieval_run_project_idx` ON `retrieval_run` (`project_id`);
--> statement-breakpoint
CREATE INDEX `retrieval_run_session_idx` ON `retrieval_run` (`session_id`);
--> statement-breakpoint
CREATE INDEX `retrieval_run_policy_idx` ON `retrieval_run` (`policy_name`);
--> statement-breakpoint
CREATE TABLE `retrieval_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text,
	`chunk_id` text,
	`run_id` text NOT NULL,
	`outcome` text NOT NULL,
	`score` real,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `retrieval_document`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunk_id`) REFERENCES `retrieval_chunk`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `retrieval_feedback_document_idx` ON `retrieval_feedback` (`document_id`);
--> statement-breakpoint
CREATE INDEX `retrieval_feedback_chunk_idx` ON `retrieval_feedback` (`chunk_id`);
--> statement-breakpoint
CREATE INDEX `retrieval_feedback_run_idx` ON `retrieval_feedback` (`run_id`);
--> statement-breakpoint
CREATE TABLE `retrieval_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`embedder_model_id` text,
	`reranker_model_id` text,
	`instruction_preset` text,
	`metadata` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `retrieval_policy_project_idx` ON `retrieval_policy` (`project_id`);
--> statement-breakpoint
CREATE INDEX `retrieval_policy_name_idx` ON `retrieval_policy` (`name`);
