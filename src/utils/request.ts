import {request, RequestOptions} from 'https';
import {URL} from 'url';

export type PostJsonOptions = Omit<RequestOptions, 'hostname' | 'path'> & {url: string; json?: Record<string, unknown>};

export const postJson = async <T>(options: PostJsonOptions): Promise<{body: T}> => {
  const {url, json, ...otherOptions} = options;
  const {headers = {}} = otherOptions;
  const {hostname, port, protocol, pathname} = new URL(url);
  const data = JSON.stringify(json);
  const requestOptions: RequestOptions = {
    hostname,
    port,
    protocol,
    path: pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      ...headers
    }
  };
  return new Promise((resolve, reject) => {
    const req = request(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({
          body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
        });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
};
