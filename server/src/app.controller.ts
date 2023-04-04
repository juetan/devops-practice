import { Controller, Get } from '@nestjs/common';
import { platform } from 'os';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('os')
  getOs(): string {
    return platform();
  }
}
