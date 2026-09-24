UPDATE restaurant_schedule
SET closed = false,
    open_time = '10:00',
    order_cutoff_time = '21:00',
    close_time = '22:00',
    version = version + 1,
    updated_at = now()
WHERE closed
   OR open_time <> '10:00'
   OR order_cutoff_time <> '21:00'
   OR close_time <> '22:00';
