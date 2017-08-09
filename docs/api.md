# API

This is the exported API for using LibVMS in a node project.

```js
const {
  VM,
  VMFactory,
  CallLog,
  DatArchive,
  Verifier,
  RPCServer,
  RPCClient
} = require('libvms')
```

## VM

```js
const {VM} = require('libvms')

// step 1. instantiate vm with a script
var vm = new VM(`exports.foo = () => 'bar'`)

// step 2. start the files archive & call log, and eval the script
await vm.deploy({
  dir: './foo-vm-data',
  title: 'The Foo Backend'
})

// step 3. start the RPC server
const {RPCServer} = require('libvms')
var server = new RPCServer()
server.mount('/foo', vm)
await server.listen({port: 5555})

// now serving!

// attributes:
vm.code // vm script contents
vm.exports // the `module.exports` of the vm script
vm.filesArchive // the vm's DatArchive
vm.callLog // the vm's CallLog

// events
vm.on('ready')
vm.on('close')

// methods
await vm.close()

// alternative instantiation: replaying a call log
var vm = VM.fromCallLog(callLog, assertions)
// ^ assertions are values in the call log that need to be tested, currently:
//   - filesArchiveUrl: the url expected for the files archive
```

## VMFactory

The `VMFactory` is a subtype of the `VM`, designed to mount other VMs.

```js
const {VMFactory} = require('libvms')

// step 1. instantiate vmfactory
var vmFactory = new VMFactory({maxVMs: 100})

// step 2. start the factory's files archive & call log
await vmFactory.deploy({
  dir: './vms',
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
vmFactory.code // vm script contents
vmFactory.exports // the `module.exports` of the vm script
vmFactory.filesArchive // the vm's DatArchive
vmFactory.callLog // the vm's CallLog

// methods:
await vmFactory.provisionVM({code, title})
await vmFactory.shutdownVM(id)
await vmFactory.close()
```

## CallLog

```js
const {CallLog} = require('libvms')

// create, open, or fetch the log
var callLog = CallLog.create(dir, code, filesArchiveUrl)
var callLog = CallLog.open(dir)
var callLog = CallLog.fetch(callLogUrl, dir) // if `dir` is falsy, will use memory

// methods/attrs:
callLog.length // how many entries in the log
await callLog.list({start, end}) // list the entries. start/end optional
await callLog.get(seq, { // get the entry at `seq`
  wait: true, // wait for index to be downloaded
  timeout: 0, // wait at max some milliseconds (0 means no timeout)
  valueEncoding: 'json' | 'utf-8' | 'binary' // defaults to the feed's valueEncoding
})

// appends (used internally):
await callLog.append(obj)
await callLog.appendInit({code, filesArchiveUrl})
await callLog.appendCall({userId, methodName, args, res, err, filesVersion})
```

## DatArchive

See [node-dat-archive](https://npm.im/node-dat-archive)

## Verifier

```js
const {Verifier} = require('libvms')

await Verifier.compareLogs(callLogA, callLogB)
await Verifier.compareArchives(archiveA, archiveB)
```

## RPCServer

```js
const {RPCServer} = require('libvms')

var server = new RPCServer()
server.mount(path, vm)
server.unmount(path)
await server.listen({port:})
server.close()
```

## RPCClient

```js
const {RPCClient} = require('libvms')

const client = new RPCClient()
await client.connect(url, {user:}) // 'user' is optional

client.url // => string
client.backendInfo.methods // => Array of strings, the method names
client.backendInfo.callLogUrl // => url of the vm's call log
client.backendInfo.filesArchiveUrl // => url of the vm's files archive

// all methods exported by the vm will be attached to `client`
await client.foo() // => 'bar'
client.close()
```