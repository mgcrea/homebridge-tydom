export const decode = (string?: string): string => (string ? Buffer.from(string, 'base64').toString('ascii') : '');
