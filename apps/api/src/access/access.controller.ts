import { Inject, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth.guard';
import { AccessService, ScannerUser } from './access.service';

@Controller('v1/scanner')
@UseGuards(AuthGuard)
export class AccessController {
  constructor(@Inject(AccessService) private readonly access: AccessService) {}

  @Post('devices')
  register(@Req() request: { user: ScannerUser }, @Body() body: unknown) { return this.access.register(request.user, body); }

  @Get('bootstrap')
  bootstrap(@Req() request: { user: ScannerUser }, @Query('deviceId') deviceId: string) { return this.access.bootstrap(request.user, deviceId); }

  @Get('revocations')
  revocations(@Req() request: { user: ScannerUser }, @Query('deviceId') deviceId: string, @Query('cursor') cursor?: string) { return this.access.revocations(request.user, deviceId, cursor); }

  @Post('shifts')
  startShift(@Req() request: { user: ScannerUser }, @Body() body: unknown) { return this.access.startShift(request.user, body); }

  @Post('shifts/:id/end')
  endShift(@Req() request: { user: ScannerUser }, @Param('id') id: string) { return this.access.endShift(request.user, id); }

  @Post('scans')
  sync(@Req() request: { user: ScannerUser }, @Body() body: unknown) { return this.access.sync(request.user, body); }
}
