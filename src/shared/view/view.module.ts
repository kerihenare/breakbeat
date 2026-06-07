import { Global, Module } from "@nestjs/common";
import { ViewRenderer } from "./view-renderer";

@Global()
@Module({
	exports: [ViewRenderer],
	providers: [ViewRenderer],
})
export class ViewModule {}
