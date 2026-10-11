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

export const mario_pistol_dl = displayList([
    [30, 40, -16, 230, 82, 16, steel], // slide and barrel
    [230, 50, -9, 240, 72, 9, dark],   // muzzle
    [40, -30, -14, 90, 42, 14, grip],  // grip, held in the fist
    [90, 14, -4, 120, 40, 4, dark],    // trigger guard
])
