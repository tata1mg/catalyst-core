import Welcome from "@containers/Welcome/Welcome"
import UploadAttire from "@containers/UploadAttire/UploadAttire"
import ShootType from "@containers/ShootType/ShootType"
import Generating from "@containers/Generating/Generating"
import VariantsGallery from "@containers/VariantsGallery/VariantsGallery"
import FinalResults from "@containers/FinalResults/FinalResults"

const routes = [
    { path: "/", end: true, component: Welcome },
    { path: "/upload-attire", end: true, component: UploadAttire },
    { path: "/shoot-type", end: true, component: ShootType },
    { path: "/generating", end: true, component: Generating },
    { path: "/variants-gallery", end: true, component: VariantsGallery },
    { path: "/final-results", end: true, component: FinalResults },
]

export default routes
