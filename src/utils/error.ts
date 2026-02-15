const errorReplacer = (key: string, value: unknown) => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return `${value}`;
};

export const stringifyError = (err: Error) => JSON.stringify(err, errorReplacer);
