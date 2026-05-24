import pc from 'picocolors'

function timestamp() {
  return pc.gray(new Date().toISOString().slice(11, 19))
}

function programTag(name) {
  return pc.cyan(`[${name}]`)
}

export const logger = {
  start(programName, message) {
    console.log(`${timestamp()} ${programTag(programName)} ${pc.yellow('▶')} ${message}`)
  },
  info(programName, message) {
    console.log(`${timestamp()} ${programTag(programName)} ${pc.blue('ℹ')} ${message}`)
  },
  done(programName, message, durationMs) {
    const duration = durationMs != null ? pc.gray(` (${durationMs}ms)`) : ''
    console.log(`${timestamp()} ${programTag(programName)} ${pc.green('✓')} ${message}${duration}`)
  },
  error(programName, message, durationMs) {
    const duration = durationMs != null ? pc.gray(` (${durationMs}ms)`) : ''
    console.log(`${timestamp()} ${programTag(programName)} ${pc.red('✗')} ${message}${duration}`)
  },
}
