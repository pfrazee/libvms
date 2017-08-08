const WebSocketServer = require('rpc-websockets').Server
const debug = require('debug')('vms')
const DEFAULT_PORT = 5555
const MAX_QUEUE_LENGTH = 1e3

// methods that can not be called remotely
const RPC_METHODS_BLACKLIST = ['init']

class RPCServer {
  constructor () {
    this.server = null
    this.mounts = {}
  }

  mount (path, vm) {
    // add the given vm to the server
    this.mounts[path] = new MountedVM(path, vm)
    if (this.server) {
      this.mounts[path].register(this)
    }
  }

  unmount (path) {
    if (this.mounts[path]) {
      this.mounts[path].unregister(this)
      delete this.mounts[path]
    }
  }

  listen (port = DEFAULT_PORT) {
    if (this.server) {
      throw new Error('Already listening')
    }

    // start the websocket server
    this.server = new WebSocketServer({port})
    await new Promise((resolve, reject) => {
      this.server.on('listening', resolve)
      this.server.on('error', reject)
    })

    // mount any waiting vms
    for (let path in this.mounts) {
      this.mounts[path].register(this)
    }
  }

  close () {
    this.server.close()
    this.server = null
  }
}

class MountedVM {
  constructor (path, vm) {
    this.path = path
    this.vm = vm
    this.callQueue = [] // backlog of RPC requests
    this.activeCall = null // call currently being processed
  }

  register (rpcServer) {
    // register all exported commands
    let methods = []
    for (let methodName in this.vm.exports) {
      let method = this.vm.exports[methodName]
      if (typeof method === 'function') {
        rpcServer.server.register(
          methodName,
          (args, meta) => this.queueRPCCall(methodName, args, meta),
          this.path
        )
        methods.push(methodName)
      }
    }
    methods = methods.filter(m => RPC_METHODS_BLACKLIST.indexOf(m) === -1)

    // register standard methods
    rpcServer.server.register(
      'handshake',
      () => {
        return {
          methods,
          callLogUrl: this.vm.callLog.url,
          filesArchiveUrl: this.vm.filesArchive.url
        }
      },
      this.path
    )
  }

  unregister (rpcServer) {
    if (rpcServer.server) {
      rpcServer.server.closeNamespace(this.path)
    }
  }

  queueRPCCall (methodName, args, meta) {
    debug('got call', methodName, args, meta)
    if (this.callQueue.length > MAX_QUEUE_LENGTH) {
      throw new Error('Too many active requests. Try again in a few minutes.')
    }
    
    if (RPC_METHODS_BLACKLIST.indexOf(methodName) !== -1) {
      throw new Error('RPC method not supported')
    }

    // add the call to the queue and then process the queue
    var promise = new Promise((resolve, reject) => {
      this.callQueue.push({
        resolve,
        reject,
        methodName,
        args,
        userId: meta.user_id
      })
    })
    this.kickCallQueue()
    return promise
  }

  async kickCallQueue () {
    if (this.activeCall) {
      return // already handling a call
    }
    if (!this.callQueue.length) {
      return // no queued calls
    }
    // run the top call on the queue
    this.activeCall = this.callQueue.shift()
    debug('handling call', this.activeCall)
    try {
      this.activeCall.resolve(await this.vm.executeCall(this.activeCall))
    } catch (e) {
      this.activeCall.reject(e)
    }
    this.activeCall = null
    // continue to the next call
    this.kickCallQueue()
  }
}

module.exports = RPCServer