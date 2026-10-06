DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET random_page_cost = 1.1', current_database());
  EXECUTE format('ALTER DATABASE %I SET effective_io_concurrency = 200', current_database());
END
$$;
