// Mario's arsenal. The weapon types come from gta-reversed's eWeaponType; their
// stats live in GTA SA's DATA\WEAPON.DAT (not part of gta-reversed), so the
// numbers below approximate SA's damage and ranges, retuned for SM64 at 30 fps.
import { UNITS_PER_METRE, angleOffAim, targetHasToBeBroken } from "./WeaponTargeting"

const metres = m => m * UNITS_PER_METRE

// Two-handed guns (as in SA: shotgun, rifles) give the left hand a `foregrip`:
// where along the barrel it holds, and how high, in right-hand units.
export const WEAPONS = [
    { id: 'pistol', name: 'Pistol', type: 'WEAPON_PISTOL',
        damage: 25, range: metres(35), clip: 17, interval: 8, reload: 36, auto: false, spread: 5 },
    { id: 'deagle', name: 'Desert Eagle', type: 'WEAPON_DESERT_EAGLE',
        damage: 70, range: metres(35), clip: 7, interval: 20, reload: 45, auto: false, spread: 4 },
    // Pellets land on every target in the cone, weaker with distance.
    { id: 'shotgun', name: 'Shotgun', type: 'WEAPON_SHOTGUN',
        damage: 15, pellets: 6, range: metres(20), clip: 1, interval: 30, reload: 30, auto: false, spread: 14,
        foregrip: [170, 20] },
    { id: 'smg', name: 'Micro SMG', type: 'WEAPON_MICRO_UZI',
        damage: 20, range: metres(30), clip: 50, interval: 3, reload: 48, auto: true, spread: 7 },
    { id: 'm4', name: 'M4', type: 'WEAPON_M4',
        damage: 30, range: metres(45), clip: 50, interval: 4, reload: 54, auto: true, spread: 4,
        foregrip: [200, 40] },
    { id: 'sniper', name: 'Sniper Rifle', type: 'WEAPON_SNIPERRIFLE',
        damage: 125, range: metres(100), clip: 1, interval: 40, reload: 40, auto: false, spread: 2,
        foregrip: [110, 0] },
    // Bare hands: no gun to draw, so B punches and kicks the SM64 way.
    { id: 'fist', name: 'Fist', type: 'WEAPON_UNARMED', melee: true },
]

export const nextWeapon = index => (index + 1) % WEAPONS.length

// GTA peds start with 100 health; SM64's heavyweights take more.
export const ENEMY_HEALTH = 100
export const HEAVY_ENEMY_HEALTH = 250

export const newAmmo = () => WEAPONS.map(weapon => ({ clip: weapon.clip, cooldown: 0, reload: 0 }))

// Advance one frame of the trigger: rate of fire, clip and reload. Returns true
// when a shot leaves the barrel. Semi-automatics need a fresh press per shot.
export const pullTrigger = (ammo, weapon, pressed, held) => {
    if (ammo.cooldown > 0) ammo.cooldown--
    if (ammo.reload > 0 && --ammo.reload === 0) ammo.clip = weapon.clip
    if (!(weapon.auto ? held : pressed) || ammo.cooldown > 0 || ammo.reload > 0) return false
    ammo.clip--
    ammo.cooldown = weapon.interval
    if (ammo.clip === 0) ammo.reload = weapon.reload
    return true
}

// Who a shot hits. With a lock (CPlayerPed::m_pTargetedObject) the bullet goes
// to the target; otherwise it flies along the aim direction and hits the nearest
// target inside the weapon's spread. Shotgun pellets hit everything in the cone.
export const shotHits = (shooter, aimYaw, lock, candidates, weapon, losBlocked) => {
    const inCone = target => !targetHasToBeBroken(shooter, target, weapon)
        && Math.abs(angleOffAim(shooter.pos, target.pos, aimYaw)) <= weapon.spread
        && !losBlocked(shooter, target)
    const distance = target => Math.hypot(...target.pos.map((v, i) => v - shooter.pos[i]))
    if (weapon.pellets) {
        return candidates.filter(target => target === lock || inCone(target)).map(target => ({
            target, damage: Math.round(weapon.damage * weapon.pellets * Math.max(0.25, 1 - distance(target) / weapon.range)),
        }))
    }
    if (lock && !targetHasToBeBroken(shooter, lock, weapon)) return [{ target: lock, damage: weapon.damage }]
    const hit = candidates.filter(inCone).sort((a, b) => distance(a) - distance(b))[0]
    return hit ? [{ target: hit, damage: weapon.damage }] : []
}
