import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StaffPostsService } from './staff-posts.service';
import { CreateStaffPostDto } from './dto/create-staff-post.dto';
import { UpdateStaffPostDto } from './dto/update-staff-post.dto';

@ApiTags('staff-posts')
@Controller('staff-posts')
export class StaffPostsController {
  constructor(private readonly staffPostsService: StaffPostsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a staff post' })
  create(@Body() createStaffPostDto: CreateStaffPostDto) {
    return this.staffPostsService.create(createStaffPostDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all staff posts' })
  findAll() {
    return this.staffPostsService.findAll();
  }

  @Get('active')
  @ApiOperation({ summary: 'Get active (non-expired) staff posts' })
  findActive() {
    return this.staffPostsService.findActive();
  }

  @Get('expired')
  @ApiOperation({ summary: 'Get expired staff posts' })
  findExpired() {
    return this.staffPostsService.findExpired();
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get staff posts statistics' })
  getStats() {
    return this.staffPostsService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get staff post by ID' })
  findOne(@Param('id') id: string) {
    return this.staffPostsService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a staff post' })
  update(@Param('id') id: string, @Body() updateStaffPostDto: UpdateStaffPostDto) {
    return this.staffPostsService.update(+id, updateStaffPostDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a staff post' })
  remove(@Param('id') id: string) {
    return this.staffPostsService.remove(+id);
  }
}
