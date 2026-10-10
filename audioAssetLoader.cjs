const path = require('path')
const crypto = require('crypto')

module.exports = function (content) {
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12)
    const filename = `audio/luigi/${path.basename(this.resourcePath, '.mp3')}-${hash}.mp3`
    this.emitFile(filename, content)
    return `module.exports = __webpack_public_path__ + ${JSON.stringify(filename)};`
}
module.exports.raw = true
