const NodeVM = require('vm')
const path = require('path')
const fs = require('fs')
const DatArchive = require('node-dat-archive')
const tempy = require('tempy')
const EventEmitter = require('events')
const uuid = require('uuid/v4')
const debug = require('debug')('vms')
const CallLog = require('./call-log')
const sandboxifyDatArchive = require('./sandboxify-dat-archive')

const CURRENT_USER = Symbol('currentUser')

class VM extends EventEmitter {
  constructor (code) {
    super()
    this.id = uuid()
    this.code = code // saved script
    this.dir = null // where on the local FS are we saving data
    this.addedAPIs = {} // APIs added by the host environment
    this.script = null // compiled script instance
    this.sandbox = null // the vm sandbox
    this.context = null // the vm context
    this.filesArchive = null // the vm's files archive
    this.callLog = null // the vm's call ledger
    this.hasEvaluated = false // has the script been evaluated yet?
    this.hasClosed = false

    // add the tests API in test mode
    if (process.env.NODE_ENV === 'test') {
      this.addAPI('test', {
        random: Math.random
      })
    }
  }

  async close () {
    if (this.hasClosed) {
      return
    }
    this.hasClosed = true

    if (this.filesArchive) {
      await this.filesArchive._close()
      this.filesArchive = null
    }

    if (this.callLog) {
      await this.callLog.close()
      this.callLog = null
    }

    this.emit('close')
  }

  get exports () {
    return this.sandbox.exports
  }

  // addAPI adds a set of methods which will be made available on
  // the `System` global inside the script's vm
  // NOTE
  // don't use this API unless you understand oracles, and the
  // significance of oracle-handling code which hasn't been added yet
  // -prf
  addAPI (name, methods) {
    this.addedAPIs[name] = methods
  }

  // deploy sets up the files archive and the call log,
  // then evaluates the script so that it can accept commands
  async deploy ({dir, title, url}) {
    this.dir = dir
    var meta = readMetaFile(dir)

    if (meta && meta.url) {
      // check the url, if given
      if (url && meta.url !== url) {
        console.error('Mismatched files archive URL.')
        console.error(`   Expected: ${url}`)
        console.error(`   Found: ${meta.url}`)
        process.exit(1)
      }
      // files archive already exists
      debug('opening existing files directory at', dir)
      this.filesArchive = new DatArchive(meta.url, {localPath: dir})
      await this.filesArchive._loadPromise
      this.callLog = await CallLog.open(dir)
    } else {
      // new files archive
      debug('creating new files directory at', dir)
      this.filesArchive = await DatArchive.create({
        localPath: dir,
        title
      })
      this.callLog = await CallLog.create(dir, this.code, this.filesArchive.url)
      writeMetaFile(dir, {title, url: this.filesArchive.url})
    }

    // add the files archive API
    this.addAPI('files', sandboxifyDatArchive(this.filesArchive))

    // evaluate the script
    evaluate(this)

    // call the script init
    if ('init' in this.sandbox.exports) {
      this.executeCall({methodName: 'init'})
    }

    this.emit('ready')
  }

  // executeCall is run by two different components:
  //  1) the RPC server, due to a received command
  //  2) the `VM.fromCallLog` replay algorithm
  // NOTE you should not run a `vm.executeCall()` unless all previous calls have completed!
  // do not use executeCall unless you are confident you know what you are doing
  // -prf
  async executeCall ({methodName, args, userId}) {
    args = args || []

    // update the caller info
    this[CURRENT_USER] = userId

    // execute the exported method
    var res, err
    try {
      res = await this.sandbox.exports[methodName](...args)
    } catch (e) {
      err = e
    }

    // log the results
    await this.callLog.appendCall({
      userId,
      methodName,
      args,
      res,
      err,
      filesVersion: this.filesArchive._archive.version
    })

    // return or throw for the RPC session
    if (err) throw err
    return res
  }

  // fromCallLog constructs a VM by replaying a call log
  // (the call log includes the vm's script)
  static async fromCallLog (callLog, assertions, {dir} = {}) {
    dir = dir || tempy.directory()

    // read the log
    const entries = await callLog.list()

    // handle init
    const initMsg = entries.shift()
    debug('init message', initMsg)
    if (initMsg.type !== 'init') {
      throw new Error(`Malformed call log: Expected "init" message, got ${initMsg.type}`)
    }
    if (initMsg.filesArchiveUrl !== assertions.filesArchiveUrl) {
      throw new Error(`Mismatched files archive URLs. Call log asserts ${initMsg.filesArchiveUrl}, server asserts ${assertions.filesArchiveUrl}`)
    }
    const vm = new VM(initMsg.code)
    await vm.deploy({dir, title: 'Replay'})
    debug('backend script exports:', Object.keys(vm.exports))

    // replay all remaining messages
    for (let i = 0; i < entries.length; i++) {
      let msg = entries[i]
      debug('replaying message', msg)
      if (msg.type !== 'call') {
        debug('unknown message type,', msg.type)
      }

      // TODO
      // wouldnt it make a lot of sense to just validate the res/err here instead of in a second loop (the Verifier) later?
      // -prf
      let {userId, methodName, args} = msg.call
      // let res, err
      try {
        /* res = */await vm.executeCall({methodName, args, userId})
      } catch (e) {
        // err = e
      }
    }

    return vm
  }
}

// readMetaFiles pulls up the `meta.json` from the deployment directory
function readMetaFile (dir) {
  // check the dir exists
  var stat
  try {
    stat = fs.statSync(dir)
  } catch (e) {
    return false
  }
  if (!stat.isDirectory()) {
    throw new Error('Target directory path is not a directory')
  }
  // load the meta.json
  try {
    var metaJson = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
  } catch (e) {
    return false
  }
  return metaJson
}

// writeMetaFile writes the `meta.json` from the deployment directory
function writeMetaFile (dir, content) {
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(content))
}

// helper to evaluate a script
function evaluate (vm) {
  if (vm.hasEvaluated) {
    return
  }
  vm.script = new NodeVM.Script(vm.code)
  vm.sandbox = createNewSandbox(vm)
  vm.context = NodeVM.createContext(vm.sandbox)
  vm.script.runInContext(vm.context)
  vm.hasEvaluated = true
}

// helper to construct the script's environment
function createNewSandbox (vm) {
  var exports = {}

  // apis exported to the VM
  var System = {
    caller: {
      // these values are set on each invocation
      get id() { return vm[CURRENT_USER] }
    }
  }
  for (var api in vm.addedAPIs) {
    System[api] = vm.addedAPIs[api]
  }

  return {
    // exports
    module: {exports},
    exports,

    // apis
    System,
    console,
    Buffer,
    setImmediate,
    setInterval,
    setTimeout,
    clearImmediate,
    clearInterval,
    clearTimeout
  }
}

module.exports = VM
