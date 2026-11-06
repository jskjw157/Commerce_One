import '../scripts/network-guard.mjs';
import { resolve } from 'node:path';
import { FileStore } from './store.js';
import { MockPlatform } from './mock.js';
import { Pilot } from './domain.js';
import { createPilotServer } from './server.js';

if(process.env.PILOT_MODE && process.env.PILOT_MODE!=='mock') throw new Error('MOCK_MODE_ONLY');
const port=Number(process.env.PORT??4173);
if(!Number.isInteger(port) || port<1024 || port>65535) throw new Error('INVALID_PORT');
const store=new FileStore(resolve(process.env.PILOT_DATA_DIR??'.local/pilot'));
const server=createPilotServer(new Pilot(store,new MockPlatform()));
server.on('error',()=>{store.close();console.error('Local server failed to start. Check port and local data directory.');process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic review pilot: http://127.0.0.1:${port} — mock data only, outbound network blocked`));
function stop() {server.close(()=>{store.close();process.exitCode=0;});server.closeAllConnections();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
