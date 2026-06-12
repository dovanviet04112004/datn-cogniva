import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../../../common/decorators/public.decorator';
import { AdminSystemService } from './admin-system.service';

@ApiTags('system')
@Controller('system')
export class PublicSystemController {
  constructor(private readonly system: AdminSystemService) {}

  @Public()
  @Get('maintenance')
  async maintenance() {
    const { config } = await this.system.getMaintenance();
    return config;
  }
}
