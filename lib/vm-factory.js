const assert = require('assert')
const path = require('path')
const VM = require('./vm')

// VM factory
// =

class VMFactory extends VM {
  constructor (code, {maxVMs} = {}) {
    super(code)
    this.maxVMs = maxVMs
    this.rpcServer = null
    this.VMs = {}
    this.numVMs = 0
    this.addAPI('vms', {
      provisionVM: opts => this.provisionVM(opts),
      shutdownVM: id => this.shutdownVM(id)
    })
  }

  setRPCServer (s) {
    this.rpcServer = s
  }

  async provisionVM ({code, title}) {
    if (this.maxVMs) {
      assert(this.numVMs < this.maxVMs, 'This host is at maximum capacity')
    }
    assert(code && typeof code === 'string', 'Code is required')

    // initiate vm
    const vm = new VM(code)
    const dir = path.join(this.dir, vm.id)
    await vm.deploy({dir, title})
    this.numVMs++
    this.VMs[vm.id] = vm
    vm.on('close', () => {
      this.numVMs--
      delete this.VMs[vm.id]
    })

    // mount to the server
    this.rpcServer.mount('/' + vm.id, vm)

    return {
      id: vm.id,
      callLogUrl: vm.callLog.url,
      filesArchiveUrl: vm.filesArchive.url
    }
  }

  async shutdownVM (id) {
    // unmount from the server
    this.rpcServer.closeNamespace('/' + id)

    // close the VM
    await this.VMs[id].close()
  }

  getVM (id) {
    return this.VMs[id]
  }
}

module.exports = VMFactory
