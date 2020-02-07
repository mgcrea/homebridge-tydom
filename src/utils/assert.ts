import {AssertionError} from 'assert';

const assert: (value: unknown, message?: string) => asserts value = (value: unknown, message?: string) => {
  if (!value) {
    throw new AssertionError({message});
  }
};

export default assert;
