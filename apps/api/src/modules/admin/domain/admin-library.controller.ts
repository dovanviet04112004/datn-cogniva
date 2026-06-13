import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AdminCtx, AdminGuard, AdminRoles, type AdminContext } from '../../../common/admin/admin.guard';
import { AdminLibraryService } from './admin-library.service';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/library')
export class AdminLibraryController {
  constructor(private readonly library: AdminLibraryService) {}

  @Get('universities')
  listUniversities(@Query('q') q?: string) {
    return this.library.listUniversities(q);
  }

  @Post('universities')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(200)
  createUniversity(@AdminCtx() ctx: AdminContext, @Body() body: unknown) {
    return this.library.createUniversity(ctx, body);
  }

  @Patch('universities/:id')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  updateUniversity(@AdminCtx() ctx: AdminContext, @Param('id') id: string, @Body() body: unknown) {
    return this.library.updateUniversity(ctx, id, body);
  }

  @Delete('universities/:id')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  deleteUniversity(@AdminCtx() ctx: AdminContext, @Param('id') id: string) {
    return this.library.deleteUniversity(ctx, id);
  }

  @Get('courses')
  listCourses(@Query('q') q?: string, @Query('universityId') universityId?: string) {
    return this.library.listCourses(q, universityId);
  }

  @Post('courses')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(200)
  createCourse(@AdminCtx() ctx: AdminContext, @Body() body: unknown) {
    return this.library.createCourse(ctx, body);
  }

  @Patch('courses/:id')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  updateCourse(@AdminCtx() ctx: AdminContext, @Param('id') id: string, @Body() body: unknown) {
    return this.library.updateCourse(ctx, id, body);
  }

  @Delete('courses/:id')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  deleteCourse(@AdminCtx() ctx: AdminContext, @Param('id') id: string) {
    return this.library.deleteCourse(ctx, id);
  }
}
