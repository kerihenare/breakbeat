import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { IdGenerator } from "../domain/ports/id-generator.port";

@Injectable()
export class UuidGenerator implements IdGenerator {
	next(): string {
		return randomUUID();
	}
}
