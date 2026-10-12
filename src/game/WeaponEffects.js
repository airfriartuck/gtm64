import * as Gbi from "../include/gbi"

const TRACER_FRAMES = 4
const IMPACT_FRAMES = 9
const MAX_SHOTS = 24
const MAX_SPARKS = 72

export const createWeaponEffects = () => ({ shots: [], sparks: [] })

export const tickWeaponEffects = effects => {
    effects.shots = effects.shots.filter(shot => --shot.frames > 0)
    effects.sparks = effects.sparks.filter(spark => --spark.frames > 0)
    for (const spark of effects.sparks) {
        for (let axis = 0; axis < 3; axis++) spark.pos[axis] += spark.velocity[axis]
        spark.velocity[1] -= 0.7
    }
}

export const queueWeaponShot = (effects, weapon, hits) => {
    // A shotgun fans out from the same muzzle; each damaged enemy gets a ray.
    const count = Math.max(weapon.pellets || 1, hits.length)
    for (let index = 0; index < count; index++) {
        const hit = hits[index % (hits.length || 1)]
        effects.shots.push({ start: null, end: hit ? [...hit.target.pos] : null,
            hit: Boolean(hit), range: weapon.range, frames: TRACER_FRAMES,
            spread: index >= hits.length && weapon.pellets ? (index - (count - 1) / 2) * 0.018 : 0 })
    }
    effects.shots.splice(0, Math.max(0, effects.shots.length - MAX_SHOTS))
}

// Hand matrices include the camera transform. Invert its orthonormal basis to
// recover the exact world-space muzzle, including Mario's pose and scale.
export const gunMuzzleInWorld = (hand, camera, muzzle) => {
    const view = [0, 1, 2].map(component => hand[3][component]
        + muzzle[0] * hand[0][component] + muzzle[1] * hand[1][component])
    const start = [0, 1, 2].map(axis => view.reduce((sum, value, component) =>
        sum + (value - camera[3][component]) * camera[axis][component], 0))
    const forward = [0, 1, 2].map(axis => hand[0].slice(0, 3).reduce((sum, value, component) =>
        sum + value * camera[axis][component], 0))
    const length = Math.hypot(...forward) || 1
    return { start, forward: forward.map(value => value / length) }
}

// SM64 exposes floor and wall probes rather than a ray cast. Stop a missed
// bullet at the first world surface so its tracer and sparks meet the wall.
export const traceWeaponSurface = (collision, start, end) => {
    if (!collision) return { end, hit: false }
    const delta = end.map((value, axis) => value - start[axis])
    const steps = Math.max(1, Math.ceil(Math.hypot(...delta) / 20))
    for (let step = 1; step <= steps; step++) {
        const pos = start.map((value, axis) => value + delta[axis] * step / steps)
        const [x, y, z] = pos
        const floor = collision.find_floor(x, y + 100, z, {})
        if ((floor >= y && floor <= y + 100)
            || collision.f32_find_wall_collision({ x, y, z }, 0, 10)) return { end: pos, hit: true }
    }
    return { end, hit: false }
}

const addImpact = (effects, pos) => {
    for (const velocity of [[3, 4, 0], [-2, 3, 2], [0, 5, -3]]) {
        effects.sparks.push({ pos: [...pos], velocity: [...velocity], frames: IMPACT_FRAMES })
    }
    effects.sparks.splice(0, Math.max(0, effects.sparks.length - MAX_SPARKS))
}

export const captureWeaponMuzzle = (effects, hand, camera, muzzle, collision) => {
    if (!effects.shots.some(shot => !shot.start)) return
    const { start, forward } = gunMuzzleInWorld(hand, camera, muzzle)
    for (const shot of effects.shots) {
        if (shot.start) continue
        shot.start = [...start]
        if (!shot.end) {
            const cosine = Math.cos(shot.spread), sine = Math.sin(shot.spread)
            const direction = [forward[0] * cosine + forward[2] * sine, forward[1],
                forward[2] * cosine - forward[0] * sine]
            const endpoint = start.map((value, axis) => value + direction[axis] * shot.range)
            const surface = traceWeaponSurface(collision, start, endpoint)
            shot.end = surface.end
            shot.hit = surface.hit
        } else if (shot.spread) {
            const distance = Math.hypot(...shot.end.map((value, axis) => value - start[axis]))
            shot.end[0] += forward[2] * shot.spread * distance
            shot.end[2] -= forward[0] * shot.spread * distance
        }
        if (shot.hit) addImpact(effects, shot.end)
    }
}

const triangle = (list, points, colour) => {
    list.push(Gbi.gsSPVertex(points.map(pos => [pos, 0, [0, 0], colour]), 3, 0),
        Gbi.gsSP1Triangle(0, 1, 2, 0))
}

const ribbon = (list, start, end, width, cameraPosition, colour) => {
    const delta = end.map((value, axis) => value - start[axis])
    const towardCamera = cameraPosition.map((value, axis) => value - start[axis])
    let side = [delta[1] * towardCamera[2] - delta[2] * towardCamera[1],
        delta[2] * towardCamera[0] - delta[0] * towardCamera[2],
        delta[0] * towardCamera[1] - delta[1] * towardCamera[0]]
    const length = Math.hypot(...side)
    side = length > 0.001 ? side.map(value => value * width / length) : [width, 0, 0]
    const corner = (point, sign) => point.map((value, axis) => value + sign * side[axis])
    const points = [corner(start, -1), corner(start, 1), corner(end, 1), corner(end, -1)]
    triangle(list, [points[0], points[1], points[2]], colour)
    triangle(list, [points[0], points[2], points[3]], colour)
}

// This display list is appended with the camera matrix, so all vertices are
// world geometry: terrain depth-tests the flashes, tracers and impact sparks.
export const weaponEffectsDisplayList = (effects, cameraPosition) => {
    if (!effects.shots.some(shot => shot.start) && !effects.sparks.length) return null
    const list = [Gbi.gsDPPipeSync(), Gbi.gsDPSetCombineMode(Gbi.G_CC_SHADE),
        Gbi.gsSPTexture(0, 0, 0, Gbi.G_TX_RENDERTILE, Gbi.G_OFF),
        Gbi.gsSPClearGeometryMode(Gbi.G_LIGHTING | Gbi.G_CULL_BACK)]
    for (const shot of effects.shots) {
        if (!shot.start) continue
        const alpha = Math.round(220 * shot.frames / TRACER_FRAMES)
        ribbon(list, shot.start, shot.end, 3, cameraPosition, [255, 225, 120, alpha])
    }
    for (const spark of effects.sparks) {
        const end = spark.pos.map((value, axis) => value - spark.velocity[axis] * 2)
        ribbon(list, spark.pos, end, 4, cameraPosition,
            [255, 185, 70, Math.round(255 * spark.frames / IMPACT_FRAMES)])
    }
    list.push(Gbi.gsSPSetGeometryMode(Gbi.G_LIGHTING | Gbi.G_CULL_BACK), Gbi.gsSPEndDisplayList())
    return list.flat()
}
