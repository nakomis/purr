import { runStorageContract } from '@purr/contracts';
import { createMemoryStorage } from './index.js';

runStorageContract('memory', async () => createMemoryStorage());
