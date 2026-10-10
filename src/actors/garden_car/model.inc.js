import * as Gbi from "../../include/gbi"

// Vertex colours keep this custom model independent of ROM textures.
const mesh = []
const triangle = (points, colour) => {
    const vertices = points.map(pos => [pos, 0, [0, 0], [...colour, 255]])
    mesh.push(Gbi.gsSPVertex(vertices, 3, 0), Gbi.gsSP1Triangle(0, 1, 2, 0))
}
const box = (x0, y0, z0, x1, y1, z1, colour) => {
    const p = [[x0,y0,z0], [x1,y0,z0], [x1,y1,z0], [x0,y1,z0],
               [x0,y0,z1], [x1,y0,z1], [x1,y1,z1], [x0,y1,z1]]
    const faces = [[0,3,2,1], [4,5,6,7], [0,4,7,3], [1,2,6,5], [3,7,6,2], [0,1,5,4]]
    faces.forEach((face, index) => {
        const shade = index === 4 ? 1 : index === 5 ? 0.55 : index < 2 ? 0.85 : 0.7
        const c = colour.map(value => Math.round(value * shade))
        triangle(face.slice(0, 3).map(i => p[i]), c)
        triangle([face[0], face[2], face[3]].map(i => p[i]), c)
    })
}
const wheel = (x, z) => {
    const sides = 12
    for (let i = 0; i < sides; i++) {
        const a = i * Math.PI * 2 / sides, b = (i + 1) * Math.PI * 2 / sides
        const p = (offset, angle, radius = 46) =>
            [x + offset, 46 + Math.cos(angle) * radius, z + Math.sin(angle) * radius]
        triangle([p(-17,a), p(17,a), p(17,b)], [30,32,38])
        triangle([p(-17,a), p(17,b), p(-17,b)], [30,32,38])
        for (const offset of [-18, 18]) {
            triangle([[x+offset,46,z], p(offset,a), p(offset,b)], [45,47,53])
            triangle([[x+offset*1.05,46,z], p(offset*1.05,a,23), p(offset*1.05,b,23)], [190,198,208])
        }
    }
}

box(-105, 48, -190, 105, 125, 200, [235, 48, 48])
// Open cabin so the companion's passenger pose is visible above the doors.
box(-90, 125, -105, 90, 145, 65, [225, 40, 40])
box(-90, 145, -105, 90, 204, -93, [225, 40, 40])
for (const x of [-48, 48]) {
    box(x - 27, 146, -65, x + 27, 155, 15, [35, 40, 48])
    box(x - 27, 155, -65, x + 27, 190, -55, [35, 40, 48])
}
box(-82, 145, 66, 82, 204, 69, [115, 205, 230]) // windshield
box(-82, 145, -109, 82, 204, -106, [115, 205, 230])
for (const side of [-1, 1]) {
    box(side * 92 - 1, 145, -92, side * 92 + 1, 204, 52, [100, 185, 215])
    box(side * 94 - 2, 131, -22, side * 94 + 2, 138, 5, [225, 225, 230])
    wheel(side * 115, -120)
    wheel(side * 115, 130)
}
box(-107, 50, 200, 107, 73, 214, [205, 213, 225])
box(-107, 50, -204, 107, 73, -190, [205, 213, 225])
for (const x of [-78, 52]) {
    box(x, 84, 201, x + 26, 108, 205, [255, 240, 165])
    box(x, 84, -208, x + 26, 104, -205, [255, 80, 55])
}

export const garden_car_dl = [
    Gbi.gsDPPipeSync(),
    Gbi.gsDPSetCombineMode(Gbi.G_CC_SHADE),
    Gbi.gsSPTexture(0, 0, 0, Gbi.G_TX_RENDERTILE, Gbi.G_OFF),
    Gbi.gsSPClearGeometryMode(Gbi.G_LIGHTING | Gbi.G_CULL_BACK),
    ...mesh,
    Gbi.gsSPSetGeometryMode(Gbi.G_LIGHTING | Gbi.G_CULL_BACK),
    Gbi.gsSPEndDisplayList(),
].flat()
