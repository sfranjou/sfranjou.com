// Calendar dates are not instants: format them without a timezone shift.
export function isCalendarDate(value)
{
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

export function formatCalendarDate(value)
{
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

// Timed concerts need an explicit offset so every visitor sees the same instant.
export function isZonedTimestamp(value)
{
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && isCalendarDate(value.slice(0, 10))
    && !Number.isNaN(Date.parse(value));
}
