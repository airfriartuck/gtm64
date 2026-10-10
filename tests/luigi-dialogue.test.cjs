const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const babel = require('@babel/core')

function setup() {
    const document = { hidden: false, body: { appendChild() {} }, createElement: () => ({ style: {}, setAttribute() {} }) }
    const exports = {}
    const code = babel.transformSync(fs.readFileSync('src/game/LuigiCarDialogue.js', 'utf8'), {
        babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    }).code
    vm.runInNewContext(code, { document, exports, console, require: name => name.endsWith('.mp3') ? name : {} })
    const calls = []
    const source = { stop() { this.stopped = true } }
    const dialogue = new exports.LuigiCarDialogue({ playPassengerVoice(bits, current) {
        calls.push({ current, bits }); return Promise.resolve(source)
    }, playDialogueClip(url, current) {
        calls.push({ current, url }); return Promise.resolve(source)
    } })
    return { dialogue, calls, source, document }
}

test('car subtitles are contextual, paced and dismissed with pending voices on exit', async () => {
    const { dialogue, calls, source } = setup()
    const car = { driving: true, speed: 0, pitch: 0 }
    dialogue.update(car, 0)
    assert.match(dialogue.subtitle.textContent, /All right, brother/)
    assert.match(calls[0].url, /enter\.mp3$/)
    await Promise.resolve()
    car.speed = 70
    dialogue.update(car, 2)
    assert.equal(calls.length, 1)
    dialogue.update(car, 6)
    assert.equal(dialogue.subtitle.hidden, true)
    dialogue.update(car, 11)
    assert.match(dialogue.subtitle.textContent, /getaway/)
    assert.equal(calls[0].current(), false)
    await Promise.resolve()
    dialogue.update(null, 12)
    assert.equal(dialogue.subtitle.hidden, true)
    assert.equal(calls[1].current(), false)
    assert.equal(source.stopped, true)
    dialogue.update(null, 30)
    assert.equal(calls.length, 2)
})

test('hidden tabs stop passenger speech and repeated driving conditions do not spam', () => {
    const { dialogue, calls, document } = setup()
    const car = { driving: true, speed: 70 }
    dialogue.update(car, 0)
    dialogue.update(car, 11)
    dialogue.update(car, 22)
    assert.equal(calls.length, 2)
    document.hidden = true
    dialogue.update(car, 23)
    assert.equal(dialogue.subtitle.hidden, true)
    assert.equal(calls[1].current(), false)
})
