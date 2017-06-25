import { VirtualFS } from './lib/VirtualFS';

let vfs = new VirtualFS;

console.log(vfs.readdirSync('/'));
