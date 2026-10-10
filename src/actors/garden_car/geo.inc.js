import { GEO_CULLING_RADIUS, GEO_OPEN_NODE, GEO_SHADOW, GEO_DISPLAY_LIST,
    GEO_CLOSE_NODE, GEO_END, LAYER_OPAQUE } from "../../engine/GeoLayout"
import { SHADOW_SQUARE_PERMANENT } from "../../game/Shadow"
import { garden_car_dl } from "./model.inc"

export const garden_car_geo = () => [
    GEO_CULLING_RADIUS(650),
    GEO_OPEN_NODE(),
        GEO_SHADOW(SHADOW_SQUARE_PERMANENT, 150, 260),
        GEO_OPEN_NODE(),
            GEO_DISPLAY_LIST(LAYER_OPAQUE, garden_car_dl),
        GEO_CLOSE_NODE(),
    GEO_CLOSE_NODE(),
    GEO_END(),
]
