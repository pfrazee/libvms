# LibVMS

An API for running cryptographically auditable VM services. Part of [NodeVMS](https://npm.im/nodevms).

## How it works

LibVMS uses the Node VM to execute Javascript files. Its goal is to enable low-trust execution of VMs through auditing.

To accomplish this, LibVMS uses [an append-only ledger](https://npm.im/hypercore) to maintain a call log. The call log records the VM script, all RPC calls, and all call results. The log is then distributed on the [Dat network](https://beakerbrowser.com/docs/inside-beaker/dat-files-protocol.html); it can not be forged, and it can not be altered after distribution (alterations are trivial to detect).

For each VM, LibVMS provisions a [Dat files archive](https://npm.im/hyperdrive) to store state. The archive is distributed over the Dat network for clients to read. As with the call log, the files archive is backed by an append-only ledger.

### Auditing

The security of LibVMS rests in the unforgeability of its ledgers, and the ability to fully replay the VM history. Any client can download the call log and files archive, instantiate their own copy of the VM, and replay the log to verify the results. If a replay is found to produce mismatched state, we can assume either A) the VM script has nondeterministic behaviors, or B) the host has tampered with the state of the VM. In either case, the VM is no longer trustworthy.

### Authentication

LibVMS has a concept of users and user ids. In debug mode, the user ids are plain authenticated strings. In production mode, the user ids are authenticated public keys and all calls are signed.

Currently, only debug mode authentication is implemented.

**This is beta software** and subject to changes.

## Examples

### Run a VM

```js
const {BackendVM, RPCServer} = require('libvms')

// the script
const scriptCode = `
  exports.foo = () => 'bar'
`
const dir = './bobs-vm-data'
const title = 'Bobs VM'

// initiate vm
const backendVM = new BackendVM(scriptCode)
await backendVM.deploy({dir, title})
console.log('backend script exports:', Object.keys(backendVM.exports))

// init rpc server
var rpcServer = new RPCServer()
rpcServer.mount('/bobs-vm', backendVM)
await rpcServer.listen(5555)
console.log('Serving at localhost:5555')
console.log('Files URL:', backendVM.filesArchive.url)
console.log('Call log URL:', backendVM.callLog.url)
```

### Connect to run commands

```js
const {RPCClient} = require('libvms')

// connect to the server
const client = new RPCClient()
await client.connect('ws://localhost:5555/bobs-vm')

// run the command
console.log(await client.foo()) // => 'bar'
```

### Audit the VM state

```js
const {RPCClient, CallLog, DatArchive, BackendVM} = require('libvms')

// connect to the server
const client = new RPCClient()
await client.connect('ws://localhost:5555/bobs-vm')

// fetch the call log
const callLog = await CallLog.fetch(client.backendInfo.callLogUrl)

// fetch the dat archive
const filesArchive = new DatArchive(client.backendInfo.filesArchiveUrl)
await filesArchive.download('/')

// replay the call log
const backendVM = await BackendVM.fromCallLog(callLog, client.backendInfo, {dir: opts.dir})

// compare outputs (will throw on mismatch)
await Verifier.compareLogs(callLog, backendVM.callLog)
await Verifier.compareArchives(filesArchive, backendVM.filesArchive)
```

### Run a VM provider

```js
const ms = require('ms')
const {VMFactory} = require('libvms')

// initialize a VM factory
const dir = './vm-factory'
const title = 'Bobs VM Host'
const vmFactory = new VMFactory()
await vmFactory.deploy({dir, title})

// init rpc server, with the factory at root
var rpcServer = new RPCServer()
rpcServer.mount('/', vmFactory)
vmFactory.setRPCServer(rpcServer)
await rpcServer.listen(5555)
console.log('Serving at localhost:5555')
console.log('Files URL:', vmFactory.filesArchive.url)
console.log('Call log URL:', vmFactory.callLog.url)
```

### Provision a VM from a host as a client

```js
const ms = require('ms')
const {RPCClient} = require('libvms')

// connect to the server
const client = new RPCClient()
await client.connect('ws://localhost:5555/')

// provision the VM
var vmInfo = await client.provisionVM({
  code: `exports.foo = () => 'bar'`,
  title: 'Bobs Provisioned VM'
})

// connect to the VM to run a command
const client2 = new RPCClient()
await client2.connect(vmInfo.rpcUrl)
console.log(await client.foo()) // => 'bar'

// audit the VM
const callLog = await CallLog.fetch(vmInfo.callLogUrl)
const filesArchive = new DatArchive(vmInfo.filesArchiveUrl)
await filesArchive.download('/')
const backendVM = await BackendVM.fromCallLog(callLog, vmInfo)
await Verifier.compareLogs(callLog, backendVM.callLog)
await Verifier.compareArchives(filesArchive, backendVM.filesArchive)
```

## API

```js
const {
  BackendVM,
  VMFactory,
  CallLog,
  DatArchive,
  Verifier,
  RPCServer,
  RPCClient
} = require('libvms')
```

### BackendVM

```js
const {BackendVM} = require('libvms')

// step 1. instantiate vm with a backend script
var backendVM = new BackendVM(`exports.foo = () => 'bar'`)

// step 2. start the files archive & call log, and eval the script
await backendVM.deploy({
  dir: './foo-backend-data',
  title: 'The Foo Backend'
})

// step 3. start the RPC server
const {RPCServer} = require('libvms')
var server = new RPCServer()
server.mount('/foo', backendVM)
await server.listen({port: 5555})

// now serving!

// attributes:
backendVM.code // backend script contents
backendVM.exports // the `module.exports` of the backend script
backendVM.filesArchive // the backend's DatArchive
backendVM.callLog // the backend's CallLog

// events
backendVM.on('ready')
backendVM.on('close')

// methods
await backendVM.executeCall({methodName, args, userId})
await backendVM.close()

// alternative instantiation: replaying a call log
var backendVM = BackendVM.fromCallLog(callLog, assertions)
// ^ assertions are values in the call log that need to be tested, currently:
//   - filesArchiveUrl: the url expected for the files archive
```

### VMFactory

The `VMFactory` is a subtype of the `BackendVM`, designed to mount other VMs.

```js
const {VMFactory} = require('libvms')

// step 1. instantiate vmfactory
var vmFactory = new VMFactory({maxVMs: 100})

// step 2. start the factory's files archive & call log
await vmFactory.deploy({
  dir: './vms-backend-datas',
  title: 'The Foo VM Host'
})

// step 3. start the RPC server
const {RPCServer} = require('libvms')
var server = new RPCServer()
server.mount('/', vmFactory)
vmFactory.setRPCServer(rpcServer)
await server.listen({port: 5555})

// now serving!

// attributes:
vmFactory.code // backend script contents
vmFactory.exports // the `module.exports` of the backend script
vmFactory.filesArchive // the backend's DatArchive
vmFactory.callLog // the backend's CallLog

// methods:
await vmFactory.provisionVM({code, title})
await vmFactory.shutdownVM(id)
await vmFactory.reprovisionSavedVMs() // call after a process restart to resume existing VMs
await vmFactory.close()
```

### CallLog

```js
const {CallLog} = require('libvms')

// create, open, or fetch the log
var callLog = CallLog.create(dir, code, filesArchiveUrl)
var callLog = CallLog.open(dir)
var callLog = CallLog.fetch(callLogUrl, dir) // if `dir` is falsy, will use memory

// methods/attrs:
callLog.length // how many entries in the log
await callLog.list({start, end}) // list the entries. start/end optional

// appends (used internally):
await callLog.append(obj)
await callLog.appendInit({code, filesArchiveUrl})
await callLog.appendCall({userId, methodName, args, res, err, filesVersion})
```

### DatArchive

See [node-dat-archive](https://npm.im/node-dat-archive)

### Verifier

```js
const {Verifier} = require('libvms')

await Verifier.compareLogs(callLogA, callLogB)
await Verifier.compareArchives(archiveA, archiveB)
```

### RPCServer

```js
const {RPCServer} = require('libvms')

var server = new RPCServer()
server.mount(path, vm)
server.unmount(path)
await server.listen({port:})
server.close()
```

### RPCClient

```js
const {RPCClient} = require('libvms')

const client = new RPCClient()
await client.connect(url, {user:}) // 'user' is optional

client.url // => string
client.backendInfo.methods // => Array of strings, the method names
client.backendInfo.callLogUrl // => url of the vm's call log
client.backendInfo.filesArchiveUrl // => url of the vm's files archive

// all methods exported by the backend will be attached to `client`
await client.foo() // => 'bar'
client.close()
```