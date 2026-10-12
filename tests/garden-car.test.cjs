const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const babel = require('@babel/core')

// Load the game's ES modules without starting the browser or WebGL. Only
// unrelated rendering/actor services are replaced; terrain queries stay real.
function runtime(render = false) {
    const root = path.resolve(__dirname, '../src')
    const objects = { gCheckingSurfaceCollisionsForCamera: 0, gEnvironmentLevels: [] }
    const linker = { ObjectListProcessor: objects, Area: { gCurrLevelNum: 16, gCurrentArea: {} }, LevelUpdate: { gMarioState: { flags: 0 } } }
    const context = vm.createContext({ gLinker: linker, window: { playerInput: {} }, console,
        document: { querySelector: () => ({ width: 640, height: 480 }), createElement: () => ({ style: {} }), body: { appendChild() {} } } })
    const cache = new Map()
    const stubs = {
        'game/Linker.js': {},
        'game/Mario.js': { MARIO_VANISH_CAP: 0 },
        'engine/graph_node.js': { GRAPH_RENDER_INVISIBLE: 16, GRAPH_RENDER_ACTIVE: 1 },
        'game/ObjectListProcessor.js': { ObjectListProcessorInstance: objects },
        'game/MacroSpecialObjects.js': {},
        'game/ObjectHelpers.js': {},
    }
    if (render) {
        delete stubs['engine/graph_node.js']
        stubs['game/Game.js'] = { GameInstance: { gDisplayList: [] } }
        stubs['game/Camera.js'] = { CameraInstance: {} }
        stubs['game/GeoMisc.js'] = { make_vertex(v,n,x,y,z,tx,ty,r,g,b,a) {
            v[n] = { pos: [x,y,z], tc: [tx,ty], color: [r,g,b,a], flag: 0 }
        } }
        stubs['engine/SurfaceCollision.js'] = { SurfaceCollisionInstance: {
            ...flatCollision, find_floor_height_and_data: () => 260,
        } }
        const programs = new Map()
        const draws = []
        const webgl = { canvas: { width: 640, height: 480 },
            lookup_shader: id => programs.get(id),
            create_and_load_new_shader(id) {
                const values = Array.from({ length: 8 }, (_, i) => (id >>> (i * 3)) & 7)
                const program = { num_inputs: Math.max(0, ...values.filter(v => v >= 1 && v <= 4)),
                    used_textures: [values.includes(5) || values.includes(6), values.includes(7)] }
                programs.set(id, program)
                return program
            },
            shader_get_info(program, textures) {
                textures[0] = program.used_textures[0]
                textures[1] = program.used_textures[1]
                return program.num_inputs
            },
            draw_triangles: (vertices, count) => draws.push({ vertices, count }),
        }
        stubs['graphics/WebGL.js'] = { WebGLInstance: new Proxy(webgl, {
            get: (target, key) => target[key] || (() => {}),
        }) }
        context.draws = draws
    }
    function load(relative) {
        const filename = path.resolve(root, relative)
        const key = path.relative(root, filename)
        if (stubs[key]) return stubs[key]
        if (cache.has(filename)) return cache.get(filename).exports
        const module = { exports: {} }
        cache.set(filename, module)
        const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
            filename, babelrc: false, configFile: false,
            presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
        }).code
        const fn = vm.runInContext(`(function(require,module,exports){${code}\n})`, context)
        fn(request => stubs[request] || load(path.relative(root, path.resolve(path.dirname(filename), request + (path.extname(request) === '.js' ? '' : '.js')))), module, module.exports)
        return module.exports
    }
    return { load, linker, context, objects, stubs }
}

const flatFloor = { normal: { y: 1 }, type: 0 }
const flatCollision = {
    find_floor(x, y, z, wrapper) { wrapper.floor = flatFloor; return 260 },
    find_water_level() { return -11000 },
    f32_find_wall_collision() { return 0 },
    find_ceil() { return 20000 },
}
const state = () => ({ x: 0, y: 260, z: 0, yaw: 0, speed: 0, floor: flatFloor })

test('Luigi retraces turns and jumps, keeps a following distance, and catches up after warps', () => {
    const { updateLuigi } = runtime().load('game/LuigiCompanion.js')
    const luigi = { pos: [0,260,0], path: [], yaw: 0 }
    let mario
    for (let frame = 0; frame < 200; frame++) {
        mario = frame < 100 ? [0,260 + Math.max(0, 100 - Math.abs(frame - 50) * 10),frame * 10]
            : [(frame - 100) * 10,260,1000]
        updateLuigi(luigi, mario, null)
        assert.ok(luigi.pos.every(Number.isFinite))
        // The follower takes the same corner instead of cutting diagonally.
        if (luigi.pos[0] > 0) assert.equal(luigi.pos[2], 1000)
    }
    for (let frame = 0; frame < 50; frame++) updateLuigi(luigi, mario, null)
    assert.ok(Math.abs(Math.hypot(...luigi.pos.map((v,i) => v - mario[i])) - 180) <= 21)
    const settled = [...luigi.pos]
    assert.equal(updateLuigi(luigi, mario, null), 'idle')
    assert.deepEqual([...luigi.pos], settled)
    updateLuigi(luigi, [10000,700,10000], null)
    assert.deepEqual([...luigi.pos], [10000,700,10000])
})

test('Luigi rides in the passenger seat, banks with the car, and follows on exit', () => {
    const { updateLuigi } = runtime().load('game/LuigiCompanion.js')
    const luigi = { pos: [0,260,0], path: [], yaw: 0 }
    const car = { ...state(), driving: true, pitch: 2000, roll: -1000 }
    assert.equal(updateLuigi(luigi, [car.x,car.y,car.z], car), 'seated')
    assert.equal(luigi.riding, true)
    const first = [...luigi.pos]
    car.x += 500
    car.yaw = 16384
    updateLuigi(luigi, [car.x,car.y,car.z], car)
    assert.ok(luigi.pos.every(Number.isFinite))
    assert.ok(luigi.pos[0] > first[0] + 300)
    assert.equal(luigi.yaw, car.yaw)
    car.driving = false
    updateLuigi(luigi, [820,260,0], car)
    assert.equal(luigi.riding, false)
    assert.deepEqual([...luigi.pos], [820,260,0])
    updateLuigi(luigi, [820,260,250], null)
    assert.ok(luigi.pos[2] > 0)
})

test('Luigi geometry renders with independent green materials and animation', () => {
    const r = runtime(true)
    Object.assign(r.stubs['game/Mario.js'], {
        ANIM_FLAG_NOLOOP: 1, ANIM_FLAG_2: 4, ANIM_FLAG_FORWARD: 2,
        ANIM_FLAG_HOR_TRANS: 8, ANIM_FLAG_VERT_TRANS: 16, ANIM_FLAG_5: 32, ANIM_FLAG_6: 64,
        ANIM_TYPE_TRANSLATION: 1, ANIM_TYPE_VERTICAL_TRANSLATION: 2,
        ANIM_TYPE_LATERAL_TRANSLATION: 3, ANIM_TYPE_NO_TRANSLATION: 4,
    })
    const graph = r.load('engine/graph_node.js')
    const layout = r.load('engine/GeoLayout.js').GeoLayoutInstance
    const renderer = r.load('engine/GeoRenderer.js').GeoRendererInstance
    const math = r.load('engine/math_util.js')
    const { luigi_geo, luigiTextureLogo } = r.load('actors/luigi/geo.inc.js')
    const marioModel = r.load('actors/mario/model.inc.js')
    assert.equal(marioModel.mario_red_lights_group.l[0].col[0], 255)
    assert.equal(luigiTextureLogo.length, 2048)
    const animation = r.load('actors/mario/marioAnimData.js').gMarioAnimData[0x72]
    const gfx = { pos: [0,260,0], angle: [0,0,0], scale: [0.9,1.12,0.9], areaIndex: 1,
        animInfo: { curAnim: animation, animFrame: 0, animAccel: 0, animYTrans: animation.unk02 },
        sharedChild: layout.process_geo_layout(luigi_geo()) }
    graph.init_graph_node(gfx, graph.GRAPH_NODE_TYPE_OBJECT)
    gfx.flags |= graph.GRAPH_RENDER_HAS_ANIMATION
    gfx.object = { gfx, rawData: [] }
    renderer.gCurGraphNodeRoot = { areaIndex: 1 }
    const matrix = math.Mat4()
    math.mtxf_identity(matrix)
    renderer.gCurGraphNodeCamera = { roll: 0, matrixPtr: matrix }
    renderer.gCurGraphNodeCamFrustum = { fov: 45 }
    renderer.gCurGraphNodeMasterList = { listHeads: Array(8).fill(null) }
    math.mtxf_identity(renderer.gMatStack[0])
    renderer.gMatStack[0][3] = [0,-260,-1000,1]
    renderer.geo_process_object(gfx)
    const lists = renderer.gCurGraphNodeMasterList.listHeads[1]
    assert.ok(lists.length >= 10)
    assert.ok(lists.every(node => node.transform.flat().every(Number.isFinite)))
    const gbi = r.load('include/gbi.js')
    const commands = []
    function visit(list) {
        for (const command of list) {
            commands.push(command)
            if (command.words.w1 && command.words.w1.childDisplayList) visit(command.words.w1.childDisplayList)
        }
    }
    lists.forEach(node => visit(node.displayList))
    assert.ok(commands.some(c => c.words.w1 && c.words.w1.imageData === luigiTextureLogo))
    const lights = commands.filter(c => c.words.w0 === gbi.G_MOVEMEM && c.words.w1.data && c.words.w1.data.col)
    assert.ok(lights.some(c => c.words.w1.data.col[1] === 200 && c.words.w1.data.col[0] === 0))
    assert.ok(!lights.some(c => c.words.w1.data.col[0] === 255 && c.words.w1.data.col[1] === 0))
    const processor = r.load('graphics/n64GfxProcessor.js').n64GfxProcessorInstance
    processor.sp_reset()
    math.mtxf_identity(processor.rsp.MP_matrix)
    for (let i = 0; i < 3; i++) processor.rsp.MP_matrix[i][i] = 0.002
    lists.forEach(node => processor.run_dl([gbi.gsSPDisplayList(node.displayList)]))
    processor.flush()
    assert.ok(r.context.draws.length > 0)
    assert.ok(r.context.draws.every(draw => draw.vertices.every(Number.isFinite)))
})

test('Luigi behavior switches animations on car entry and exit and ignores an unloaded car', () => {
    const r = runtime()
    r.linker.SurfaceCollision = flatCollision
    const c = r.load('include/object_constants.js')
    const carObject = { rawData: [], activeFlags: 1 }
    carObject.rawData[c.oPosX] = carObject.rawData[c.oPosZ] = carObject.rawData[c.oFaceAngleYaw] = 0
    carObject.rawData[c.oPosY] = 260
    r.objects.gCurrentObject = carObject
    const car = r.load('game/GardenCar.js')
    car.bhv_garden_car_loop()
    const luigi = { rawData: [], gfx: { animInfo: {} } }
    luigi.rawData[c.oPosX] = luigi.rawData[c.oPosZ] = luigi.rawData[c.oFaceAngleYaw] = 0
    luigi.rawData[c.oPosY] = 260
    const m = { pos: [0,260,0], action: 1, health: 0x880, marioObj: { rawData: [], gfx: { flags: 0 } } }
    r.linker.LevelUpdate.gMarioState = m
    r.objects.gCurrentObject = luigi
    const { bhv_luigi_companion_loop } = r.load('game/LuigiCompanion.js')
    bhv_luigi_companion_loop()
    const idle = luigi.gfx.animInfo.curAnim
    r.context.window.playerInput = { buttonPressedVehicle: true }
    car.updateGardenCar(m, 1, true)
    bhv_luigi_companion_loop()
    assert.equal(luigi.luigi.riding, true)
    assert.ok(luigi.gfx.animInfo.curAnim.flags & 4)
    assert.equal(luigi.gfx.animInfo.animFrame, luigi.gfx.animInfo.curAnim.unk08 - 1)
    assert.notEqual(luigi.gfx.animInfo.curAnim, idle)
    r.context.window.playerInput = { stickY: 64 }
    for (let frame = 0; frame < 200; frame++) {
        car.updateGardenCar(m, 1, true)
        bhv_luigi_companion_loop()
        assert.ok([c.oPosX,c.oPosY,c.oPosZ].every(field => Number.isFinite(luigi.rawData[field])))
    }
    r.context.window.playerInput = { buttonPressedVehicle: true }
    car.updateGardenCar(m, 1, true)
    bhv_luigi_companion_loop()
    assert.equal(luigi.luigi.riding, false)
    assert.equal(luigi.gfx.animInfo.curAnim, idle)
    r.linker.Area.gCurrentArea = {}
    assert.equal(car.getGardenCar(), null)
    bhv_luigi_companion_loop()
    assert.equal(luigi.luigi.riding, false)
})

// GTA physics helpers: run frames, read km/h and heading in degrees.
const drive = (physics, car, input, frames, collision = flatCollision, unsafe = [], until) => {
    for (let i = 0; i < frames; i++) {
        physics.advanceCar(car, input, collision, unsafe)
        if (until && until(car)) return i + 1
    }
    return frames
}
const degrees = yaw => (((yaw + 32768) % 65536 + 65536) % 65536 - 32768) * 180 / 32768

test('GTA handling: settles on its springs, accelerates through the gears, steers, brakes and reverses', () => {
    const physics = runtime().load('game/GardenCarPhysics.js')
    const car = state()
    drive(physics, car, {}, 60)
    assert.equal(car.onGround, 4, 'all four wheels on the ground')
    assert.ok(Math.abs(car.y - 260) < 5, 'rests at ground height on its suspension')
    assert.ok(physics.carAtRest(car), 'a settled car sleeps')
    let spin = 0
    const toHundred = drive(physics, car, { stickY: 64 }, 600, flatCollision, [], c => { if (c.wheelStates[1] === 1) spin++; return c.kmh >= 100 })
    assert.ok(toHundred / 30 > 3 && toHundred / 30 < 9, `0-100 km/h in ${toHundred / 30}s`)
    assert.ok(spin > 0, 'rear-wheel drive spins its tyres off the line')
    assert.ok(car.gear >= 2, 'changes up')
    drive(physics, car, { stickY: 64 }, 30 * 40)
    assert.ok(car.kmh > 150 && car.kmh < 180, `top speed ${car.kmh}`)
    assert.ok(car.z > 10000)
    const heading = car.yaw
    drive(physics, car, { stickY: 64, stickX: 64 }, 30)
    assert.ok(degrees(heading - car.yaw) > 5, 'steering right turns right (yaw decreases)')
    const stop = drive(physics, car, { stickY: -64 }, 600, flatCollision, [], c => c.kmh < 1)
    assert.ok(stop / 30 < 6, `brakes to a stop in ${stop / 30}s`)
    drive(physics, car, { stickY: -64 }, 30 * 10)
    assert.ok(car.speed < 0, 'holding brake at a standstill reverses')
    assert.ok(car.kmh < 60, `reverse is limited (${car.kmh} km/h)`)
})

test('GTA handling: the handbrake locks the rear wheels and kicks the tail out', () => {
    const physics = runtime().load('game/GardenCarPhysics.js')
    const car = state()
    drive(physics, car, {}, 30)
    drive(physics, car, { stickY: 64 }, 600, flatCollision, [], c => c.kmh >= 70)
    const before = car.yaw
    drive(physics, car, { stickX: 64, buttonDownA: true }, 30)
    const { forward, moveSpeed } = car.body
    const slip = Math.abs(Math.atan2(forward[0], forward[2]) - Math.atan2(moveSpeed[0], moveSpeed[2])) * 180 / Math.PI
    assert.ok(slip > 5, `slides sideways (${slip.toFixed(1)}°)`)
    assert.ok(degrees(before - car.yaw) > 20, 'swings round')
    assert.ok([car.wheelStates[1], car.wheelStates[3]].every(s => s === 3), 'rear wheels locked')
})
test('walls stop the car with an impact, and it never enters water, voids, low ceilings or death floors', () => {
    const physics = runtime().load('game/GardenCarPhysics.js')
    // A wall across the road at z = 1500 pushes the body back out.
    const wall = { ...flatCollision, f32_find_wall_collision(pos) {
        if (pos.z <= 1500 - 30) return 0
        pos.z = 1500 - 30
        return 1
    } }
    const car = state()
    let impact = false
    drive(physics, car, { stickY: 64 }, 300, wall, [], c => { impact = impact || c.impact; return false })
    assert.ok(car.z < 1500, 'stays behind the wall')
    assert.ok(impact, 'reports the crash')
    assert.ok(Math.abs(car.speed) < 5, 'stopped by the wall')
    const hazards = [
        { find_water_level: (x, z) => z > 1000 ? 400 : -11000 },
        { find_floor: (x, y, z, w) => { w.floor = z > 1000 ? null : flatFloor; return z > 1000 ? -11000 : 260 } },
        { find_floor: (x, y, z, w) => { w.floor = z > 1000 ? { normal: { y: 1 }, type: 10 } : flatFloor; return 260 } },
        { find_ceil: (x, y, z) => z > 1000 ? 360 : 20000 },
    ]
    for (const hazard of hazards) {
        const blocked = state()
        drive(physics, blocked, { stickY: 64 }, 300, { ...flatCollision, ...hazard }, [10])
        assert.ok(blocked.z < 1000 && blocked.z > 300, `stopped short of the hazard at ${blocked.z}`)
        assert.ok([blocked.x, blocked.y, blocked.z].every(Number.isFinite))
    }
})
test('climbs and descends hills, pitches and banks with the ground, and falls off ledges', () => {
    const physics = runtime().load('game/GardenCarPhysics.js')
    const angle = 15 * Math.PI / 180, grade = Math.tan(angle)
    const floor = { type: 0, normal: { x: 0, y: Math.cos(angle), z: -Math.sin(angle) } }
    const hill = { ...flatCollision, find_floor(x, y, z, wrapper) {
        const height = 260 + Math.max(0, z) * grade
        wrapper.floor = y >= height - 78 ? (z > 0 ? floor : flatFloor) : null
        return wrapper.floor ? height : -11000
    } }
    const car = { ...state(), z: -600 }
    drive(physics, car, {}, 30, hill)
    drive(physics, car, { stickY: 64 }, 30 * 6, hill)
    assert.ok(car.z > 1000, 'climbs a 15° hill')
    assert.ok(Math.abs(car.y - (260 + car.z * grade)) < 15, 'wheels stay on the slope')
    assert.ok(Math.abs(degrees(car.pitch) + 15) < 4, `pitches nose-up with the hill (${degrees(car.pitch)}°)`)
    assert.ok(Math.abs(degrees(car.roll)) < 2)
    const top = car.y
    drive(physics, car, { stickY: -64 }, 30 * 3, hill)
    drive(physics, car, { stickY: -64 }, 30 * 3, hill)
    assert.ok(car.y < top, 'reverses back down')
    assert.ok(physics.findCarExit(car, hill, []))

    // Parked across the slope it banks instead of pitching.
    const sideways = { ...state(), z: 800, y: 260 + 800 * grade, yaw: 16384 }
    drive(physics, sideways, {}, 60, hill)
    assert.ok(Math.abs(Math.abs(degrees(sideways.roll)) - 15) < 4, `banks across the hill (${degrees(sideways.roll)}°)`)
    assert.ok(Math.abs(degrees(sideways.pitch)) < 3)

    // GTA cars can drive off a ledge: it falls and lands on the ground below.
    const cliff = { ...flatCollision, find_floor(x, y, z, wrapper) {
        wrapper.floor = flatFloor
        return z > 600 && y > 220 ? 260 : z > 600 ? -40 : 260
    } }
    const ledge = { ...flatCollision, find_floor(x, y, z, wrapper) {
        wrapper.floor = flatFloor
        return z > 600 ? -40 : 260
    } }
    const edge = state()
    drive(physics, edge, { stickY: 64 }, 30 * 4, ledge)
    assert.ok(edge.z > 700, 'drives over the edge')
    drive(physics, edge, {}, 30 * 3, ledge)
    assert.ok(Math.abs(edge.y + 40) < 10, `lands on the ground below (${edge.y})`)
    assert.equal(edge.onGround, 4)
    assert.ok(cliff)
})
function castleGroundCollision(r) {
    const surfaces = r.load('include/surface_terrains.js')
    const loader = r.load('game/SurfaceLoad.js').SurfaceLoadInstance
    loader.clear_dynamic_surfaces()
    const data = r.load('levels/castle_grounds/areas/1/collision.inc.js').castle_grounds_seg7_collision_level
    let objects = 2 + data[1] * 3
    while (data[objects] !== surfaces.TERRAIN_LOAD_OBJECTS) {
        if (data[objects] === surfaces.TERRAIN_LOAD_CONTINUE) objects++
        else objects += 2 + data[objects + 1] * (loader.surface_has_force(data[objects]) ? 4 : 3)
    }
    // The final two water boxes follow the special object records. Skip actor
    // spawning while keeping the unmodified vertices, triangles and water.
    const water = data.length - 15
    assert.equal(data[water], surfaces.TERRAIN_LOAD_ENVIRONMENT)
    loader.load_area_terrain(1, [...data.slice(0, objects), ...data.slice(water)], null, null)
    return r.load('engine/SurfaceCollision.js').SurfaceCollisionInstance
}

test('the car settles on the real castle grounds spawn and can drive off and be exited', () => {
    const r = runtime()
    const collision = castleGroundCollision(r)
    const physics = r.load('game/GardenCarPhysics.js')
    const car = { ...state(), x: -900, z: 4400, yaw: 32768 }
    drive(physics, car, {}, 60, collision, [10, 1])
    assert.equal(car.onGround, 4)
    assert.ok(physics.findCarExit(car, collision, [10, 1]))
    drive(physics, car, { stickY: 64 }, 45, collision, [10, 1])
    assert.ok(car.z < 4200, 'car must be able to leave its parking spot')
})
test('long drives update the real castle grounds camera without exceptions', () => {
    const r = runtime()
    const collision = castleGroundCollision(r)
    const physics = r.load('game/GardenCarPhysics.js')
    Object.assign(r.stubs, {
        'game/Area.js': { AreaInstance: r.linker.Area },
        'game/LevelUpdate.js': { LevelUpdateInstance: r.linker.LevelUpdate },
        'game/Hud.js': { HudInstance: { set_hud_camera_status() {} } },
        'game/IngameMenu.js': { CAM_SELECTION_MARIO: 1, CAM_SELECTION_FIXED: 2, DIALOG_RESPONSE_NONE: 0,
            IngameMenuInstance: { gDialogID: -1, gDialogResponse: 0, get_dialog_id: () => -1 } },
        'game/SaveFile.js': { gLastCompletedStarNum: 0 },
        'game/MarioActionsCutscene.js': {},
        'game/Paintings.js': {},
        'engine/BehaviorCommands.js': {},
        'audio/external.js': new Proxy({}, { get: () => () => {} }),
        'style-loader': {},
    })
    r.linker.Area.gCurrentArea.index = 1
    const camera = r.load('game/Camera.js').CameraInstance
    const car = { ...state(), x: -900, z: 4400, yaw: 32768 }
    const view = { mode: 16, defMode: 16, cutscene: 0, yaw: 0, nextYaw: 0,
        pos: [-900,600,5200], focus: [-900,260,4400] }
    r.linker.Area.gCurrentArea.camera = view
    r.linker.LevelUpdate.gMarioState = { pos: [car.x, car.y, car.z], action: 0x0C400201,
        faceAngle: [0,car.yaw,0], floor: car.floor, waterLevel: -11000, forwardVel: 0 }
    Object.assign(camera.gPlayerCameraState, r.linker.LevelUpdate.gMarioState)
    camera.reset_camera(view)
    camera.init_camera(view)
    for (let frame = 0; frame < 3000; frame++) {
        const input = { stickY: frame % 500 < 350 ? 64 : -64,
            stickX: frame % 300 < 100 ? 0 : frame % 300 < 200 ? 32 : -32 }
        r.context.window.playerInput = input
        physics.advanceCar(car, input, collision, [10,1])
        const mario = r.linker.LevelUpdate.gMarioState
        mario.pos = [car.x, car.y, car.z]
        mario.faceAngle = [0, car.yaw, 0]
        mario.floor = car.floor
        Object.assign(camera.gPlayerCameraState, mario)
        r.context.window.gGlobalTimer = frame
        camera.update_camera(view)
        assert.ok(view.pos.every(Number.isFinite), `invalid camera position at frame ${frame}`)
    }
})

test('nearby birds can bank into turns without reassigning a constant', () => {
    const r = runtime()
    const turns = []
    Object.assign(r.stubs, {
        'game/Interaction.js': {},
        'engine/BehaviorCommands.js': {},
        'game/behaviors/platform_on_track.inc.js': {},
        'game/BehaviorData.js': {},
        'game/MarioActionsCutscene.js': {},
        'game/Camera.js': {},
        'game/IngameMenu.js': {},
        'game/SpawnSound.js': {},
        'engine/SurfaceCollision.js': {},
    })
    r.stubs['game/ObjectHelpers.js'].approach_s16_symmetric = (roll, target, speed) => {
        turns.push({ target, speed })
        return target
    }
    const constants = r.load('include/object_constants.js')
    const bird = { rawData: [] }
    r.objects.gCurrentObject = bird
    const { obj_roll_to_match_yaw_turn } = r.load('game/ObjBehaviors2.js')
    const cases = [[4000,0,4000], [20000,0,0x3000], [0,20000,-0x3000], [32760,-32760,-16]]
    for (const [yaw, target, expected] of cases) {
        bird.rawData[constants.oMoveAngleYaw] = yaw
        bird.rawData[constants.oFaceAngleRoll] = 0
        assert.doesNotThrow(() => obj_roll_to_match_yaw_turn(target, 0x3000, 600))
        assert.deepEqual(turns.at(-1), { target: expected, speed: 600 })
        assert.equal(bird.rawData[constants.oFaceAngleRoll], expected)
    }
})

test('enter, move, exit safely and release Mario when changing levels', () => {
    const r = runtime()
    r.linker.SurfaceCollision = flatCollision
    const constants = r.load('include/object_constants.js')
    const object = { rawData: [], activeFlags: 1 }
    object.rawData[constants.oPosX] = 0
    object.rawData[constants.oPosY] = 260
    object.rawData[constants.oPosZ] = 0
    object.rawData[constants.oFaceAngleYaw] = 0
    r.objects.gCurrentObject = object
    const api = r.load('game/GardenCar.js')
    api.bhv_garden_car_loop()
    const mario = { pos: [0,260,300], action: 1, health: 0x880, marioObj: { rawData: [], gfx: { flags: 0 } } }
    r.context.window.playerInput = { buttonPressedVehicle: true }
    assert.equal(api.updateGardenCar(mario, 1, true), true)
    assert.equal(mario.marioObj.gfx.flags & 16, 16)
    r.context.window.playerInput = { stickY: 64 }
    api.updateGardenCar(mario, 1, true)
    assert.ok(mario.pos[2] > 0)
    r.context.window.playerInput = { buttonPressedVehicle: true }
    assert.equal(api.updateGardenCar(mario, 1, true), false)
    assert.equal(mario.marioObj.gfx.flags & 16, 0)
    assert.ok(Math.abs(mario.pos[0]) >= 200, 'exits beside the car')
    api.updateGardenCar(mario, 1, true)
    r.linker.Area.gCurrLevelNum = 6
    assert.equal(api.updateGardenCar(mario, 1, true), false)
    assert.equal(mario.marioObj.gfx.flags & 16, 0)
    r.linker.Area.gCurrLevelNum = 16
    r.linker.Area.gCurrentArea = {}
    assert.equal(api.updateGardenCar(mario, 1, true), false)
    assert.equal(object.gardenCar.driving, false)
})

test('exit stays blocked when all nearby spaces are unsafe', () => {
    const { findCarExit } = runtime().load('game/GardenCarPhysics.js')
    assert.equal(findCarExit(state(), { ...flatCollision, find_ceil: () => 300 }, []), null)
    assert.equal(findCarExit(state(), { ...flatCollision, f32_find_wall_collision: () => 1 }, []), null)
})

test('renders the car scene graph when it enters the camera view', () => {
    const r = runtime(true)
    const graph = r.load('engine/graph_node.js')
    const layout = r.load('engine/GeoLayout.js').GeoLayoutInstance
    const renderer = r.load('engine/GeoRenderer.js').GeoRendererInstance
    const math = r.load('engine/math_util.js')
    const constants = r.load('include/object_constants.js')
    const geometry = r.load('actors/garden_car/geo.inc.js').garden_car_geo
    const model = r.load('actors/garden_car/model.inc.js').garden_car_dl
    const gfx = { pos: [-900,260,4400], angle: [0,32768,0], scale: [1,1,1],
        animInfo: {}, areaIndex: 1, sharedChild: layout.process_geo_layout(geometry()) }
    graph.init_graph_node(gfx, graph.GRAPH_NODE_TYPE_OBJECT)
    const object = { gfx, rawData: [] }
    gfx.object = object
    object.rawData[constants.oFaceAngleYaw] = 32768
    renderer.gCurGraphNodeRoot = { areaIndex: 1 }
    const cameraMatrix = math.Mat4()
    math.mtxf_identity(cameraMatrix)
    renderer.gCurGraphNodeCamera = { roll: 0, matrixPtr: cameraMatrix }
    renderer.gCurGraphNodeCamFrustum = { fov: 45 }
    renderer.gCurGraphNodeMasterList = { listHeads: Array(8).fill(null) }
    math.mtxf_identity(renderer.gMatStack[0])
    renderer.gMatStack[0][3] = [900,-260,-5400,1]
    renderer.geo_process_object(gfx)
    assert.ok(renderer.gCurGraphNodeMasterList.listHeads[1].some(node => node.displayList === model))
    const soundPosition = gfx.cameraToObject
    gfx.pos[0] += 10
    renderer.geo_process_object(gfx)
    assert.equal(gfx.cameraToObject, soundPosition)
    assert.equal(soundPosition[0], 10)
})

test('processes every car triangle through the graphics command interpreter', () => {
    const r = runtime(true)
    const messages = []
    r.context.console = { log: (...args) => messages.push(args), dir: (...args) => messages.push(args) }
    const gfx = r.load('graphics/n64GfxProcessor.js').n64GfxProcessorInstance
    const gbi = r.load('include/gbi.js')
    const math = r.load('engine/math_util.js')
    const model = r.load('actors/garden_car/model.inc.js').garden_car_dl
    gfx.sp_reset()
    math.mtxf_identity(gfx.rsp.MP_matrix)
    for (let i = 0; i < 3; i++) gfx.rsp.MP_matrix[i][i] = 0.002
    gfx.run_dl([gbi.gsSPDisplayList(model)])
    gfx.flush()
    assert.deepEqual(messages, [])
    const triangles = model.filter(command => command.words.w0 === gbi.G_TRI1).length
    assert.equal(r.context.draws.reduce((sum, draw) => sum + draw.count, 0), triangles)
    assert.ok(r.context.draws.every(draw => draw.vertices.every(Number.isFinite)))
})

// Deterministic Math.random stand-in for Luigi's wandering.
const seeded = seed => () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const yawDelta = (a, b) => ((b - a + 32768) % 65536 + 65536) % 65536 - 32768

test('Luigi wanders on his own near an idle Mario, turning and accelerating smoothly', () => {
    const { updateLuigi } = runtime().load('game/LuigiCompanion.js')
    const world = { collision: flatCollision, random: seeded(7) }
    const mario = [0, 260, 0]
    const luigi = { pos: [0, 260, -180], path: [], yaw: 0 }
    const poses = new Set()
    let furthest = 0, yaw = luigi.yaw, speed = 0, wanders = 0, previousMode
    for (let frame = 0; frame < 3000; frame++) {
        const pose = updateLuigi(luigi, mario, null, world)
        poses.add(pose)
        if (luigi.mode === 'wander' && previousMode !== 'wander') wanders++
        previousMode = luigi.mode
        const away = Math.hypot(luigi.pos[0], luigi.pos[2])
        furthest = Math.max(furthest, away)
        assert.ok(away < 900 + 1, `stays on the leash (${away})`)
        assert.ok(Math.abs(yawDelta(yaw, luigi.yaw)) <= 0x0C00 + 1, 'no instant turns')
        assert.ok(Math.abs(luigi.speed - speed) <= 5 + 1e-9, 'no instant speed changes')
        yaw = luigi.yaw
        speed = luigi.speed
    }
    assert.ok(wanders >= 5, `explores repeatedly (${wanders})`)
    assert.ok(furthest > 400)
    for (const pose of ['idle', 'walking', 'running', 'hopping']) assert.ok(poses.has(pose), pose)
})

test('Luigi avoids lava and water and comes back when Mario sets off', () => {
    const { updateLuigi } = runtime().load('game/LuigiCompanion.js')
    const lava = { normal: { y: 1 }, type: 1 }
    const collision = { ...flatCollision,
        find_floor(x, y, z, wrapper) { wrapper.floor = x > 200 ? lava : flatFloor; return 260 },
        find_water_level: (x, z) => z < -200 ? 400 : -11000 }
    const world = { collision, random: seeded(3) }
    const luigi = { pos: [0, 260, 150], path: [], yaw: 0 }
    let mario = [0, 260, 0]
    for (let frame = 0; frame < 3000; frame++) {
        updateLuigi(luigi, mario, null, world)
        assert.ok(luigi.pos[0] <= 200 && luigi.pos[2] >= -200, `stayed on safe ground at ${luigi.pos}`)
    }
    // Mario runs off east along the safe strip's edge; Luigi gives up wandering and follows.
    collision.find_floor = (x, y, z, wrapper) => { wrapper.floor = flatFloor; return 260 }
    for (let frame = 0; frame < 200; frame++) {
        mario = [0, 260, frame * 15]
        updateLuigi(luigi, mario, null, world)
    }
    assert.equal(luigi.mode, 'follow')
    assert.ok(Math.hypot(luigi.pos[0] - mario[0], luigi.pos[2] - mario[2]) < 400, 'caught up')
})

test('Luigi explores the real castle grounds without leaving safe ground', () => {
    const r = runtime()
    const collision = castleGroundCollision(r)
    const { updateLuigi, groundAt } = r.load('game/LuigiCompanion.js')
    const world = { collision, random: seeded(11) }
    const floor = {}
    const mario = [-1300, collision.find_floor(-1300, 500, 4500, floor), 4500]
    const luigi = { pos: [-1500, collision.find_floor(-1500, 500, 4800, {}), 4800], path: [], yaw: 0 }
    let moved = 0, previous = [...luigi.pos]
    for (let frame = 0; frame < 4000; frame++) {
        updateLuigi(luigi, mario, null, world)
        moved += Math.hypot(luigi.pos[0] - previous[0], luigi.pos[2] - previous[2])
        previous = [...luigi.pos]
        const ground = groundAt(collision, luigi.pos[0], luigi.pos[1], luigi.pos[2])
        assert.notEqual(ground, null, `unsafe ground at ${luigi.pos.map(Math.round)}`)
        assert.ok(Math.abs(ground - luigi.pos[1]) < 2, `floating or sunk at ${luigi.pos.map(Math.round)}`)
    }
    assert.ok(moved > 3000, `explores the lawn (${Math.round(moved)} units)`)
})

test('the Mustang model is baked within budget, upright, nose to +Z, with glass on the translucent layer', () => {
    const r = runtime(true)
    const gbi = r.load('include/gbi.js')
    const model = r.load('actors/garden_car/model.inc.js')
    const vertices = list => list.filter(command => command.words.w0 === gbi.G_VTX)
        .flatMap(command => command.words.w1.vertices || [])
    const triangles = list => list.filter(command => command.words.w0 === gbi.G_TRI1).length
    const body = vertices(model.garden_car_dl), glass = vertices(model.garden_car_glass_dl)
    assert.ok(body.length > 0 && glass.length > 0)
    assert.ok(triangles(model.garden_car_dl) + triangles(model.garden_car_glass_dl) <= 5000, 'cheap enough to draw every frame')
    const axis = (list, i) => list.map(v => v[0][i])  // [position, flag, uv, rgba]
    const all = [...body, ...glass]
    // Decoded geometry matches the size the converter reported.
    assert.ok(Math.abs(Math.max(...axis(all, 2)) - Math.min(...axis(all, 2)) - model.CAR_MODEL_SIZE.length) <= 2)
    assert.ok(Math.abs(Math.max(...axis(all, 0)) - Math.min(...axis(all, 0)) - model.CAR_MODEL_SIZE.width) <= 2)
    assert.equal(Math.min(...axis(all, 1)), 0, 'wheels on the ground')
    // The windscreen is ahead of the middle of the car.
    const windscreen = glass.filter(v => v[0][1] > 80)
    assert.ok(windscreen.reduce((s, v) => s + v[0][2], 0) / windscreen.length > 0, 'nose faces +Z')
    assert.ok(glass.every(v => v[3][3] < 255), 'glass is see-through')
    const geo = r.load('actors/garden_car/geo.inc.js').garden_car_geo()
    const layers = geo.filter(node => node.args && node.args[1] === model.garden_car_glass_dl).map(node => node.args[0])
    assert.deepEqual([...layers], [r.load("engine/GeoLayout.js").LAYER_TRANSPARENT])
})

test('Luigi sits in the passenger seat, on the far side from the driver', () => {
    const { updateLuigi, PASSENGER_SEAT } = runtime().load('game/LuigiCompanion.js')
    const luigi = { pos: [0, 0, 0], path: [], yaw: 0 }
    updateLuigi(luigi, [0, 0, 0], { ...state(), x: 1000, y: 260, z: 2000, yaw: 0, driving: true })
    // +X is the driver's (left) side of a car facing +Z.
    assert.ok(PASSENGER_SEAT[0] < 0)
    assert.deepEqual([...luigi.pos].map(Math.round), [1000 + PASSENGER_SEAT[0], 260 + PASSENGER_SEAT[1], 2000 + PASSENGER_SEAT[2]])
})

test('a frame of GTA car physics on the real castle grounds stays cheap', () => {
    const r = runtime()
    const collision = castleGroundCollision(r)
    const physics = r.load('game/GardenCarPhysics.js')
    const car = { ...state(), x: -900, z: 4400, yaw: 32768 }
    drive(physics, car, {}, 30, collision, [10, 1])
    const start = process.hrtime.bigint()
    const frames = 900
    for (let i = 0; i < frames; i++) {
        physics.advanceCar(car, { stickY: 64, stickX: i % 200 < 100 ? 40 : -40, buttonDownA: i % 300 > 280 }, collision, [10, 1])
        assert.ok([car.x, car.y, car.z].every(Number.isFinite), `finite at frame ${i}`)
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6 / frames
    assert.ok(ms < 2, `${ms.toFixed(3)} ms per frame`)
})
