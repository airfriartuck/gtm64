import * as Gbi from "../../include/gbi"

// Vertex-coloured gun meshes in Mario's right-hand space: the hand bone runs
// along +X (wrist at 0, knuckles near 100), so barrels point down +X.
const boxMesh = (mesh, x0, y0, z0, x1, y1, z1, colour) => {
    const p = [[x0,y0,z0], [x1,y0,z0], [x1,y1,z0], [x0,y1,z0],
               [x0,y0,z1], [x1,y0,z1], [x1,y1,z1], [x0,y1,z1]]
    const faces = [[0,3,2,1], [4,5,6,7], [0,4,7,3], [1,2,6,5], [3,7,6,2], [0,1,5,4]]
    faces.forEach((face, index) => {
        const shade = index === 4 ? 1 : index === 5 ? 0.55 : index < 2 ? 0.85 : 0.7
        const c = [...colour.map(value => Math.round(value * shade)), 255]
        for (const tri of [[face[0], face[1], face[2]], [face[0], face[2], face[3]]]) {
            mesh.push(Gbi.gsSPVertex(tri.map(i => [p[i], 0, [0, 0], c]), 3, 0), Gbi.gsSP1Triangle(0, 1, 2, 0))
        }
    })
}

const displayList = boxes => {
    const mesh = []
    boxes.forEach(box => boxMesh(mesh, ...box))
    return [
        Gbi.gsDPPipeSync(),
        Gbi.gsDPSetCombineMode(Gbi.G_CC_SHADE),
        Gbi.gsSPTexture(0, 0, 0, Gbi.G_TX_RENDERTILE, Gbi.G_OFF),
        Gbi.gsSPClearGeometryMode(Gbi.G_LIGHTING | Gbi.G_CULL_BACK),
        ...mesh,
        Gbi.gsSPSetGeometryMode(Gbi.G_LIGHTING | Gbi.G_CULL_BACK),
        Gbi.gsSPEndDisplayList(),
    ].flat()
}

const steel = [70, 74, 82], dark = [38, 40, 46], grip = [92, 60, 40]
const silver = [178, 182, 190], black = [28, 29, 33], wood = [120, 74, 38], scope = [20, 22, 26]

// Each gun lists its boxes and where its muzzle is, for the flash.
const guns = {
    pistol: { muzzle: [240, 61], boxes: [
        [30, 40, -16, 230, 82, 16, steel],   // slide and barrel
        [230, 50, -9, 240, 72, 9, dark],     // muzzle
        [40, -30, -14, 90, 42, 14, grip],    // grip, held in the fist
        [90, 14, -4, 120, 40, 4, dark],      // trigger guard
    ] },
    deagle: { muzzle: [272, 70], boxes: [
        [20, 42, -20, 262, 98, 20, silver],
        [262, 56, -11, 272, 84, 11, dark],
        [40, -34, -16, 92, 44, 16, black],
        [92, 14, -5, 126, 42, 5, dark],
    ] },
    shotgun: { muzzle: [392, 60], boxes: [
        [-30, 46, -12, 380, 74, 12, dark],   // barrel
        [380, 50, -9, 392, 70, 9, black],
        [170, 22, -15, 290, 50, 15, wood],   // pump
        [-190, 14, -16, 40, 66, 16, wood],   // stock behind the hand
        [40, -26, -12, 90, 46, 12, wood],    // grip
    ] },
    smg: { muzzle: [232, 62], boxes: [
        [10, 34, -18, 190, 90, 18, black],   // receiver
        [190, 52, -7, 232, 72, 7, dark],     // short barrel
        [56, -120, -11, 92, 36, 11, dark],   // long magazine through the grip
        [100, 10, -4, 130, 36, 4, dark],
    ] },
    m4: { muzzle: [392, 64], boxes: [
        [-70, 40, -15, 240, 94, 15, black],  // receiver
        [240, 54, -7, 392, 74, 7, dark],     // barrel
        [120, -60, -12, 160, 40, 12, dark],  // magazine
        [-200, 28, -13, -70, 88, 13, black], // stock
        [20, 94, -6, 150, 120, 6, black],    // carry handle
        [40, -26, -12, 90, 42, 12, black],   // grip
    ] },
    sniper: { muzzle: [472, 64], boxes: [
        [0, 54, -8, 460, 74, 8, dark],       // long barrel
        [460, 56, -10, 472, 72, 10, black],
        [-200, 16, -17, 130, 76, 17, wood],  // stock and fore-end
        [50, 98, -13, 230, 130, 13, scope],  // scope
        [90, 76, -5, 110, 98, 5, scope],
        [40, -26, -12, 90, 40, 12, wood],
    ] },
}

const flash = ([x, y]) => [
    [x, y - 30, -30, x + 70, y + 30, 30, [255, 190, 50]],
    [x + 10, y - 14, -14, x + 110, y + 14, 14, [255, 248, 200]],
]

export const mario_gun_dls = Object.fromEntries(Object.entries(guns).map(([id, gun]) =>
    [id, { muzzle: gun.muzzle, dl: displayList(gun.boxes), flashDl: displayList([...gun.boxes, ...flash(gun.muzzle)]) }]))

