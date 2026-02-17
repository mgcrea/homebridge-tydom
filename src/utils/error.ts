const errorReplacer = (key: string, value: unknown) => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  // Explicitly convert unknown values to strings to satisfy @typescript-eslint/restrict-template-expressions
  return String(value);
};

export const stringifyError = (err: Error) => JSON.stringify(err, errorReplacer);
