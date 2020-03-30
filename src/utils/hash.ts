import crypto from 'crypto';

export const sha256 = (data: crypto.BinaryLike): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      const shasum = crypto.createHash('sha256');
      shasum.update(data);
      resolve(shasum.digest('hex'));
    } catch (err) {
      reject(err);
    }
  });
};
