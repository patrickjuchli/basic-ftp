import { Client } from '../lib/ftp';

const client = new Client();

console.log(client.closed);
console.log(client.ftp.encoding);